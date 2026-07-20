package db_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
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

// Reproduces the upgrade path that broke a real database: a todos table created
// by an older build, missing columns the model has gained since. Migrate must
// add them rather than leaving the table stale.
func TestMigrateAddsColumnsToExistingTable(t *testing.T) {
	bdb := open(t)
	ctx := context.Background()

	// An "old" todos table: no recurring_todo_id, no starred, no show_from.
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

	// A row that already existed before the upgrade.
	if _, err := bdb.ExecContext(ctx, `INSERT INTO todos
		(user_id, context_id, description, state, position, created_at, updated_at)
		VALUES (1, 1, 'pre-existing', 'active', 1, '2026-01-01', '2026-01-01')`); err != nil {
		t.Fatal(err)
	}

	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// Reading that old row must work: its new columns are NULL, and a NOT NULL
	// model field like starred has to scan cleanly rather than blowing up.
	var old domain.Todo
	if err := bdb.NewSelect().Model(&old).Where("t.description = ?", "pre-existing").Scan(ctx); err != nil {
		t.Fatalf("select pre-existing row after migrate: %v", err)
	}
	if old.Starred {
		t.Fatal("pre-existing row should default to not starred")
	}
	if old.RecurringTodoID != nil {
		t.Fatal("pre-existing row should have no recurring pattern")
	}

	// The columns added after that table was created must now exist.
	for _, col := range []string{"recurring_todo_id", "starred", "show_from"} {
		var n int
		err := bdb.NewRaw(
			"SELECT COUNT(*) FROM pragma_table_info('todos') WHERE name = ?", col,
		).Scan(ctx, &n)
		if err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("column %q missing after migrate", col)
		}
	}

	// And the model must actually be usable against the upgraded table.
	todo := &domain.Todo{
		UserID: 1, ContextID: 1, Description: "works now", State: domain.StateActive,
	}
	if _, err := bdb.NewInsert().Model(todo).Exec(ctx); err != nil {
		t.Fatalf("insert into upgraded table: %v", err)
	}
	var got domain.Todo
	if err := bdb.NewSelect().Model(&got).Where("t.id = ?", todo.ID).Scan(ctx); err != nil {
		t.Fatalf("select from upgraded table: %v", err)
	}
	if got.Description != "works now" {
		t.Fatalf("unexpected row: %+v", got)
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

// A table missing entirely is still created.
func TestMigrateCreatesMissingTables(t *testing.T) {
	bdb := open(t)
	ctx := context.Background()
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatal(err)
	}
	if _, err := bdb.NewInsert().
		Model(&domain.Preference{UserID: 1, DateFormat: "d", TimeZone: "UTC", Locale: "en", Theme: "system"}).
		Exec(ctx); err != nil {
		t.Fatalf("insert into newly created table: %v", err)
	}
}
