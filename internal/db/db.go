// Package db wires bun to either SQLite or Postgres based on a URL scheme,
// and runs schema migrations.
package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/driver/sqliteshim"
	"github.com/uptrace/bun/migrate"

	"github.com/jdel/gotracks/internal/domain"
)

// Open connects to the database described by url and returns a bun.DB.
// Supported schemes: sqlite:<path> and postgres://... (or postgresql://).
func Open(url string, debug bool) (*bun.DB, error) {
	switch {
	case strings.HasPrefix(url, "sqlite:"):
		dsn := sqliteDSN(url)
		// SQLite will not create missing parent directories, and the default
		// path lives under the XDG data dir which may not exist yet. Without
		// this the first query fails with a bare "unable to open database file".
		if err := ensureParentDir(dsn); err != nil {
			return nil, fmt.Errorf("open sqlite %q: %w", dsn, err)
		}
		sqldb, err := sql.Open(sqliteshim.ShimName, dsn)
		if err != nil {
			return nil, fmt.Errorf("open sqlite %q: %w", dsn, err)
		}
		// sql.Open is lazy, so a bad path only surfaces on first use. Ping here
		// to fail with the offending path instead of inside an unrelated query.
		if err := sqldb.Ping(); err != nil {
			sqldb.Close()
			return nil, fmt.Errorf("open sqlite %q (from %q): %w", dsn, url, err)
		}
		// SQLite is single-writer; keep one connection to avoid "database is locked".
		sqldb.SetMaxOpenConns(1)
		return withDebug(bun.NewDB(sqldb, sqlitedialect.New()), debug), nil

	case strings.HasPrefix(url, "postgres://"), strings.HasPrefix(url, "postgresql://"):
		sqldb := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(url)))
		return withDebug(bun.NewDB(sqldb, pgdialect.New()), debug), nil

	default:
		return nil, fmt.Errorf("unsupported database url: %q (want sqlite: or postgres://)", url)
	}
}

// sqliteDSN turns a sqlite: URL into a filesystem path.
//
// Both "sqlite:file.db" and the URL-ish "sqlite://file.db" are accepted, since
// the latter is what people naturally type. Only "sqlite:///abs/path" (three
// slashes, the SQLAlchemy convention) means an absolute path — otherwise
// "sqlite://tracks.db" would silently resolve to /tracks.db at the filesystem
// root, which is not writable and fails with an opaque error.
func sqliteDSN(url string) string {
	dsn := strings.TrimPrefix(url, "sqlite:")
	if rest, ok := strings.CutPrefix(dsn, "//"); ok {
		// "sqlite:///abs" leaves a leading slash here; keep it. Anything else
		// after "//" is meant as a relative path.
		return rest
	}
	return dsn
}

// ensureParentDir creates the directory holding a SQLite database file.
//
// In-memory databases and bare filenames have no directory to create, and a
// DSN may carry query parameters ("file.db?_pragma=…") which are not part of
// the path.
func ensureParentDir(dsn string) error {
	if dsn == "" || strings.Contains(dsn, ":memory:") || strings.Contains(dsn, "mode=memory") {
		return nil
	}
	path := dsn
	path = strings.TrimPrefix(path, "file:")
	if i := strings.IndexAny(path, "?"); i >= 0 {
		path = path[:i]
	}
	dir := filepath.Dir(path)
	if dir == "." || dir == "" || dir == string(filepath.Separator) {
		return nil
	}
	return os.MkdirAll(dir, 0o755)
}

func withDebug(db *bun.DB, debug bool) *bun.DB {
	// The hook is always installed so raising the log level to debug at runtime
	// starts logging queries with no restart. It normally logs at debug (dropped
	// unless the level is debug); --db.debug promotes it to info so queries are
	// always visible.
	level := zerolog.DebugLevel
	if debug {
		level = zerolog.InfoLevel
	}
	db.AddQueryHook(queryLogHook{level: level})
	return db
}

// queryLogHook logs each query through the request's correlation-scoped logger,
// so a debug line ties a SQL statement to the HTTP request that caused it. It
// logs the parameterized template, never the arg values, so credentials and
// personal data stay out of the log.
type queryLogHook struct{ level zerolog.Level }

func (queryLogHook) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	return ctx
}

func (h queryLogHook) AfterQuery(ctx context.Context, e *bun.QueryEvent) {
	if h.level < zerolog.GlobalLevel() {
		return // would be dropped; skip the work
	}
	query := e.QueryTemplate
	if query == "" {
		query = e.Query
	}
	ev := zerolog.Ctx(ctx).WithLevel(h.level).
		Str("op", e.Operation()).
		Str("query", query).
		Dur("dur", time.Since(e.StartTime))
	if e.Err != nil && !errors.Is(e.Err, sql.ErrNoRows) {
		ev = ev.Err(e.Err)
	}
	ev.Msg("db query")
}

// models lists every table managed by the schema, in dependency order.
func models() []any {
	return []any{
		(*domain.User)(nil),
		(*domain.RefreshToken)(nil),
		(*domain.Context)(nil),
		(*domain.Project)(nil),
		(*domain.Todo)(nil),
		(*domain.Tag)(nil),
		(*domain.Tagging)(nil),
		(*domain.Note)(nil),
		(*domain.RecurringTodo)(nil),
		(*domain.Preference)(nil),
		(*domain.Attachment)(nil),
		(*domain.InstanceSettings)(nil),
		(*domain.Credential)(nil),
		(*domain.TwoFactor)(nil),
		(*domain.RecoveryCode)(nil),
		(*domain.LoginAttempt)(nil),
		(*domain.Ephemeral)(nil),
		(*domain.UsageSnapshot)(nil),
	}
}

var migrations = migrate.NewMigrations()

// Migrate applies pending schema migrations. Databases created before migration
// tracking was introduced are adopted only when their schema contains the
// complete baseline.
func Migrate(ctx context.Context, db *bun.DB) (err error) {
	trackingColumns, err := existingColumns(ctx, db, "bun_migrations")
	if err != nil {
		return fmt.Errorf("inspect migration tracking: %w", err)
	}
	legacy := false
	if len(trackingColumns) == 0 {
		legacy, err = legacySchema(ctx, db)
		if err != nil {
			return err
		}
	}

	migrator := migrate.NewMigrator(db, migrations, migrate.WithMarkAppliedOnSuccess(true))
	if err := migrator.Init(ctx); err != nil {
		return fmt.Errorf("initialize migrations: %w", err)
	}
	if err := migrator.Lock(ctx); err != nil {
		return err
	}
	defer func() {
		if unlockErr := migrator.Unlock(context.WithoutCancel(ctx)); err == nil && unlockErr != nil {
			err = fmt.Errorf("unlock migrations: %w", unlockErr)
		}
	}()

	if legacy {
		applied, err := migrator.AppliedMigrations(ctx)
		if err != nil {
			return fmt.Errorf("read applied migrations: %w", err)
		}
		if len(applied) == 0 {
			baseline := migrations.Sorted()[0]
			baseline.GroupID = 1
			if err := migrator.MarkApplied(ctx, &baseline); err != nil {
				return fmt.Errorf("adopt baseline migration: %w", err)
			}
		}
	}

	if _, err := migrator.Migrate(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

// legacySchema reports whether domain tables already exist and verifies that
// an untracked database matches the baseline before it is adopted.
func legacySchema(ctx context.Context, db *bun.DB) (bool, error) {
	found := false
	var missingTable string
	for _, model := range models() {
		table := db.Dialect().Tables().Get(reflect.TypeOf(model).Elem())
		if table == nil {
			return false, fmt.Errorf("unknown model %T", model)
		}
		existing, err := existingColumns(ctx, db, table.Name)
		if err != nil {
			return false, fmt.Errorf("inspect table %q: %w", table.Name, err)
		}
		if len(existing) == 0 {
			if missingTable == "" {
				missingTable = table.Name
			}
			continue
		}
		found = true
		for _, field := range table.Fields {
			if !existing[field.Name] {
				return false, fmt.Errorf(
					"untracked schema does not match baseline: table %q is missing column %q",
					table.Name, field.Name,
				)
			}
		}
	}
	if !found {
		return false, nil
	}
	if missingTable != "" {
		return false, fmt.Errorf(
			"untracked schema does not match baseline: table %q is missing",
			missingTable,
		)
	}
	return true, nil
}

// existingColumns lists the column names of a table for the active dialect.
func existingColumns(ctx context.Context, db *bun.DB, table string) (map[string]bool, error) {
	out := map[string]bool{}

	switch db.Dialect().Name() {
	case dialect.SQLite:
		rows, err := db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", table))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var (
				cid        int
				name, typ  string
				notNull    int
				dflt       sql.NullString
				primaryKey int
			)
			if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &primaryKey); err != nil {
				return nil, err
			}
			out[name] = true
		}
		return out, rows.Err()

	default: // Postgres and anything else exposing information_schema
		rows, err := db.QueryContext(ctx,
			"SELECT column_name FROM information_schema.columns WHERE table_name = ?", table)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return nil, err
			}
			out[name] = true
		}
		return out, rows.Err()
	}
}
