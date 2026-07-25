package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// asAdmin puts a signed-in account and a client address on the request, the way
// the auth and RealIP middleware would, so a handler can name the actor.
func asAdmin(r *http.Request) *http.Request {
	ctx := context.WithValue(r.Context(), ctxKeyUser, &domain.User{ID: 1, Email: "admin@example.com", IsAdmin: true})
	ctx = context.WithValue(ctx, ctxKeyClientIP, "203.0.113.7")
	return r.WithContext(ctx)
}

// An export must record a fingerprint of exactly the bytes it produced, so a
// copy of the file can later be proven the untampered original without the log
// keeping a second copy of everyone's history.
func TestAuditExportRecordsHashOfWhatItSent(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	audit := service.NewAuditService(store.Audit)
	audit.Record(ctx, service.Entry{Action: domain.AuditLoginFailed, Outcome: domain.AuditFailure, TargetEmail: "a@example.com"})
	audit.Record(ctx, service.Entry{Action: domain.AuditLoginSucceeded, ActorEmail: "b@example.com"})

	h := &auditHandler{audit: audit}

	for _, format := range []string{"json", "csv"} {
		rec := httptest.NewRecorder()
		req := asAdmin(httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit/export?format="+format, nil))
		h.export(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", format, rec.Code)
		}
		body := rec.Body.Bytes()
		if len(body) == 0 {
			t.Fatalf("%s: empty export", format)
		}

		// The export event is written after the body; find it and compare.
		page, err := audit.Search(ctx, repo.AuditFilter{Action: domain.AuditAdminAuditExported}, 1, 50)
		if err != nil {
			t.Fatal(err)
		}
		var recorded string
		for _, e := range page.Items {
			if e.Detail != "" && e.Detail[:len(format)] == format {
				recorded = e.Hash
			}
		}
		sum := sha256.Sum256(body)
		if recorded != hex.EncodeToString(sum[:]) {
			t.Errorf("%s: recorded hash %q does not match the bytes sent %q",
				format, recorded, hex.EncodeToString(sum[:]))
		}
		if len(recorded) != 64 {
			t.Errorf("%s: hash is not a full sha256: %q", format, recorded)
		}
	}
}

// Reading the log leaves a trace, but the fingerprint belongs to exports only —
// a plain search has nothing to fingerprint.
func TestAuditSearchLeavesNoHash(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	audit := service.NewAuditService(store.Audit)
	h := &auditHandler{audit: audit}

	rec := httptest.NewRecorder()
	req := asAdmin(httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit", nil))
	h.list(rec, req)

	page, err := audit.Search(ctx, repo.AuditFilter{Action: domain.AuditAdminAuditSearched}, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("a search recorded %d traces, want 1", page.Total)
	}
	if page.Items[0].Hash != "" {
		t.Errorf("a search carried a hash: %q", page.Items[0].Hash)
	}
}

// failingWriter is a ResponseWriter that stops accepting bytes partway, the way
// a client that disconnects mid-download does.
type failingWriter struct {
	header http.Header
	budget int
}

func (f *failingWriter) Header() http.Header {
	if f.header == nil {
		f.header = http.Header{}
	}
	return f.header
}
func (f *failingWriter) WriteHeader(int) {}
func (f *failingWriter) Write(p []byte) (int, error) {
	if f.budget <= 0 {
		return 0, errors.New("client gone")
	}
	if len(p) > f.budget {
		n := f.budget
		f.budget = 0
		return n, errors.New("client gone")
	}
	f.budget -= len(p)
	return len(p), nil
}

// A transfer that dies mid-flight must still leave a trace, and the recorded
// fingerprint must be of the whole export the server produced — not of the
// truncated fraction the client received before it left.
func TestAuditExportAbortedMidTransferStillTraces(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()
	audit := service.NewAuditService(store.Audit)
	for i := 0; i < 50; i++ {
		audit.Record(ctx, service.Entry{
			Action: domain.AuditLoginFailed, Outcome: domain.AuditFailure,
			TargetEmail: "probe@example.com", IP: "203.0.113.1",
			UserAgent: "a-long-user-agent-string-to-make-rows-fat",
		})
	}
	h := &auditHandler{audit: audit}

	// The full export, for the hash it should have recorded.
	full := httptest.NewRecorder()
	h.export(full, asAdmin(httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit/export?format=csv&action=account.login.failed", nil)))
	wantSum := sha256.Sum256(full.Body.Bytes())
	wantHash := hex.EncodeToString(wantSum[:])

	// The same export to a client that dies after a few hundred bytes.
	aborted := &failingWriter{budget: 300}
	h.export(aborted, asAdmin(httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit/export?format=csv&action=account.login.failed", nil)))

	page, err := audit.Search(ctx, repo.AuditFilter{Action: domain.AuditAdminAuditExported}, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	// Two export events: the full one and the aborted one.
	if page.Total != 2 {
		t.Fatalf("recorded %d export traces, want 2 (an abort must not lose its trace)", page.Total)
	}
	// page is newest first, so the aborted export is item 0.
	aught := page.Items[0]
	if aught.Hash != wantHash {
		t.Errorf("aborted export recorded hash %q, want the full-content hash %q", aught.Hash, wantHash)
	}
	if !strings.Contains(aught.Detail, "delivery interrupted") {
		t.Errorf("an interrupted delivery was not noted: %q", aught.Detail)
	}
	// It is still recorded as a success: the server released the data, which is
	// the accountable fact regardless of what the client received.
	if aught.Outcome != domain.AuditSuccess {
		t.Errorf("aborted export outcome = %q, want success", aught.Outcome)
	}
}
