package service_test

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"testing"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"

	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func newUsageReportService(t *testing.T, snapshots int) *service.UsageReportService {
	t.Helper()
	sqldb, err := sql.Open(sqliteshim.ShimName, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	sqldb.SetMaxOpenConns(1)
	bdb := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { bdb.Close() })
	ctx := context.Background()
	if err := db.Migrate(ctx, bdb); err != nil {
		t.Fatal(err)
	}
	store := repo.NewStore(bdb)

	rows := make([]*domain.UsageSnapshot, snapshots)
	for i := range rows {
		rows[i] = &domain.UsageSnapshot{UserID: int64(i + 1), Email: fmt.Sprintf("u%d@x.test", i)}
	}
	if err := store.UsageReports.Replace(ctx, rows); err != nil {
		t.Fatal(err)
	}
	settings := service.NewSettingsService(store.Settings, true)
	return service.NewUsageReportService(store.UsageReports, settings, service.Quotas{})
}

// SR-15: an out-of-range page/size must not overflow (page-1)*size into a
// negative slice index and panic. Both come straight from HTTP query values.
func TestUsageReportLargePageCannotPanic(t *testing.T) {
	svc := newUsageReportService(t, 10)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Latest panicked: %v", r)
		}
	}()

	rep, err := svc.Latest(context.Background(), service.ReportQuery{
		Page: math.MaxInt, PageSize: math.MaxInt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rep.PageSize > 200 {
		t.Fatalf("page size not clamped: %d", rep.PageSize)
	}
	if len(rep.Accounts) > rep.PageSize {
		t.Fatalf("returned %d accounts for page size %d", len(rep.Accounts), rep.PageSize)
	}
	if rep.Total != 10 {
		t.Fatalf("total = %d, want 10", rep.Total)
	}
}

// A normal request still pages correctly after the clamps.
func TestUsageReportPagesWithinBounds(t *testing.T) {
	svc := newUsageReportService(t, 10)
	ctx := context.Background()

	first, err := svc.Latest(ctx, service.ReportQuery{Page: 1, PageSize: 4})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Accounts) != 4 {
		t.Fatalf("page 1 returned %d, want 4", len(first.Accounts))
	}
	last, err := svc.Latest(ctx, service.ReportQuery{Page: 3, PageSize: 4})
	if err != nil {
		t.Fatal(err)
	}
	if len(last.Accounts) != 2 { // 10 rows, size 4 => pages of 4,4,2
		t.Fatalf("page 3 returned %d, want 2", len(last.Accounts))
	}
}
