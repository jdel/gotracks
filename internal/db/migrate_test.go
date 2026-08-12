package db_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"

	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/domain"
)

func open(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open(sqliteshim.ShimName, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	sqldb.SetMaxOpenConns(1)
	bdb := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { bdb.Close() })
	return bdb
}

// An untracked partial schema must not be guessed at or silently marked current.
func TestMigrateRejectsIncompleteUntrackedSchema(t *testing.T) {
	bdb := open(t)
	ctx := context.Background()

	_, err := bdb.ExecContext(ctx, `CREATE TABLE todos (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id BIGINT NOT NULL,
		context_id BIGINT NOT NULL,
		project_id BIGINT,
		description VARCHAR NOT NULL,
		notes VARCHAR,
		due TIMESTAMP,
		completed_at TIMESTAMP,
		state VARCHAR NOT NULL,
		position BIGINT NOT NULL,
		created_at TIMESTAMP NOT NULL,
		updated_at TIMESTAMP NOT NULL
	)`)
	if err != nil {
		t.Fatal(err)
	}

	err = db.Migrate(ctx, bdb)
	if err == nil || !strings.Contains(err.Error(), `table "todos" is missing column`) {
		t.Fatalf("expected an incompatible-schema error, got %v", err)
	}

	var applied int
	if err := bdb.NewRaw(
		"SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'bun_migrations'",
	).Scan(ctx, &applied); err != nil {
		t.Fatal(err)
	}
	if applied != 0 {
		t.Fatal("an incompatible schema must not initialize migration tracking")
	}
}

func TestMigrateAdoptsCurrentUntrackedSchema(t *testing.T) {
	bdb := open(t)
	ctx := context.Background()
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatal(err)
	}

	todo := &domain.Todo{UserID: 1, ContextID: 1, Description: "keep me", State: domain.StateActive}
	if _, err := bdb.NewInsert().Model(todo).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := bdb.ExecContext(ctx, "DROP TABLE bun_migrations"); err != nil {
		t.Fatal(err)
	}
	if _, err := bdb.ExecContext(ctx, "DROP TABLE bun_migration_locks"); err != nil {
		t.Fatal(err)
	}

	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatalf("adopt current schema: %v", err)
	}
	var description string
	if err := bdb.NewRaw("SELECT description FROM todos WHERE id = ?", todo.ID).Scan(ctx, &description); err != nil {
		t.Fatal(err)
	}
	if description != todo.Description {
		t.Fatalf("existing row changed during adoption: %q", description)
	}
	var migrationNames []string
	if err := bdb.NewRaw("SELECT name FROM bun_migrations ORDER BY name").Scan(ctx, &migrationNames); err != nil {
		t.Fatal(err)
	}
	// The baseline is adopted rather than run; everything after it is applied
	// normally, so each new migration belongs in this list.
	want := []string{"202607230001", "202607230002", "202607240001", "202607240002", "202607240003", "202607240004", "202607270001", "202608120001", "202608120002"}
	if len(migrationNames) != len(want) {
		t.Fatalf("unexpected applied migrations: %v", migrationNames)
	}
	for i, name := range want {
		if migrationNames[i] != name {
			t.Fatalf("unexpected applied migrations: %v", migrationNames)
		}
	}
}

// Migrate must be safe to run repeatedly.
func TestMigrateIsIdempotent(t *testing.T) {
	bdb := open(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := db.Migrate(ctx, bdb); err != nil {
			t.Fatalf("migrate pass %d: %v", i, err)
		}
	}
	todo := &domain.Todo{UserID: 1, ContextID: 1, Description: "x", State: domain.StateActive}
	if _, err := bdb.NewInsert().Model(todo).Exec(ctx); err != nil {
		t.Fatalf("insert after repeated migrate: %v", err)
	}
}

// Regression: the default database path lives under the XDG data dir, which
// does not exist on a fresh install. Open must create it rather than failing
// with "unable to open database file".
func TestOpenCreatesMissingParentDirectory(t *testing.T) {
	root := t.TempDir()
	// Two levels deep, neither of which exists yet.
	path := filepath.Join(root, "gotracks", "data", "gotracks.db")

	bdb, err := db.Open("sqlite:"+path, false)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer bdb.Close()

	ctx := context.Background()
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatalf("migrate into a fresh directory: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("database file was not created: %v", err)
	}
}

// "sqlite://name.db" is a natural thing to type and must mean a relative path,
// not /name.db at the filesystem root.
func TestOpenAcceptsDoubleSlashAsRelative(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)

	bdb, err := db.Open("sqlite://tracks.db", false)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer bdb.Close()

	if err := db.Migrate(context.Background(), bdb); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "tracks.db")); err != nil {
		t.Fatalf("expected the database beside the working directory: %v", err)
	}
}

// Three slashes keep their absolute meaning.
func TestOpenTripleSlashIsAbsolute(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "abs.db")

	bdb, err := db.Open("sqlite://"+path, false)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer bdb.Close()

	if err := db.Migrate(context.Background(), bdb); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected the database at the absolute path: %v", err)
	}
}

// An in-memory database has no directory to create.
func TestOpenInMemory(t *testing.T) {
	bdb, err := db.Open("sqlite::memory:", false)
	if err != nil {
		t.Fatalf("open in-memory: %v", err)
	}
	defer bdb.Close()
	if err := db.Migrate(context.Background(), bdb); err != nil {
		t.Fatalf("migrate in-memory: %v", err)
	}
}

// A tracked baseline interrupted after creating only some tables is retried.
func TestMigrateRetriesIncompleteBaseline(t *testing.T) {
	bdb := open(t)
	ctx := context.Background()
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatal(err)
	}
	if _, err := bdb.ExecContext(ctx, "DELETE FROM bun_migrations"); err != nil {
		t.Fatal(err)
	}
	if _, err := bdb.ExecContext(ctx, "DROP TABLE preferences"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatalf("retry baseline: %v", err)
	}
	if _, err := bdb.NewInsert().
		Model(&domain.Preference{UserID: 1, DateFormat: "d", TimeZone: "UTC", Locale: "en", Theme: "system"}).
		Exec(ctx); err != nil {
		t.Fatalf("insert into recreated table: %v", err)
	}
}

// Actions and recurrence patterns no longer carry notes, and the column goes
// with the field: a schema that still had it would keep the data alive and
// leave the two out of step.
func TestMigrateDropsActionNotes(t *testing.T) {
	bdb := open(t)
	ctx := context.Background()
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatal(err)
	}

	for _, table := range []string{"todos", "recurring_todos"} {
		var count int
		if err := bdb.NewRaw(
			"SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = 'notes'", table,
		).Scan(ctx, &count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s still has a notes column", table)
		}
	}
}
