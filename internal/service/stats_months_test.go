package service

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"

	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/repo"
)

func TestPerMonthSeriesContinuousOnMonthEnd(t *testing.T) {
	sqldb, err := sql.Open(sqliteshim.ShimName, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	sqldb.SetMaxOpenConns(1)
	bdb := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { bdb.Close() })
	if err := db.Migrate(context.Background(), bdb); err != nil {
		t.Fatal(err)
	}
	store := repo.NewStore(bdb)

	old := timeNow
	timeNow = func() time.Time { return time.Date(2026, 3, 31, 12, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { timeNow = old })

	s, err := NewStatsService(store.Stats, store.Contexts).Compute(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.PerMonth) != 12 {
		t.Fatalf("want 12 months, got %d", len(s.PerMonth))
	}
	seen := map[string]bool{}
	for _, mc := range s.PerMonth {
		if seen[mc.Month] {
			t.Fatalf("month %s appears twice in %v", mc.Month, s.PerMonth)
		}
		seen[mc.Month] = true
	}
	for _, want := range []string{"2025-04", "2025-06", "2025-09", "2025-11", "2026-02", "2026-03"} {
		if !seen[want] {
			t.Fatalf("series is missing %s: %v", want, s.PerMonth)
		}
	}
}
