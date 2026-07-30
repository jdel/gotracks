package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// Opening the audit log — even with no filters — makes its entries visible, so
// it is itself an administrative read and must be recorded.
func TestAuditListRecordsASearchWithoutFilters(t *testing.T) {
	store := newTestStore(t)
	audit := service.NewAuditService(store.Audit)
	h := &auditHandler{audit: audit}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit?page=1&pageSize=50", nil)
	rec := httptest.NewRecorder()
	h.list(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	// The record is written after the response, so a second read is what sees it.
	page, err := audit.Search(context.Background(), repo.AuditFilter{}, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range page.Items {
		if e.Action == domain.AuditAdminAuditSearched {
			found = true
		}
	}
	if !found {
		t.Fatalf("opening the audit log recorded no search event; got %d entries", len(page.Items))
	}
}
