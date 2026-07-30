package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

func TestCreateNoteRejectsOversizedBody(t *testing.T) {
	store := newTestStore(t)
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)
	quotas := service.NewQuotaService(service.Quotas{}, store)
	h := &noteHandler{notes: store.Notes, projects: projects, quotas: quotas}

	body := `{"body":"` + strings.Repeat("x", service.MaxNotesCharacters+1) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/notes", bytes.NewBufferString(body))
	req = req.WithContext(context.WithValue(req.Context(), ctxKeyClaims, &auth.Claims{UserID: 1}))
	rec := httptest.NewRecorder()

	h.create(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestUpdateNoteRejectsOversizedBody(t *testing.T) {
	store := newTestStore(t)
	projects := service.NewProjectService(store.Projects, store.Todos, store.Notes, store.Recurring, store.Contexts)
	quotas := service.NewQuotaService(service.Quotas{}, store)
	h := &noteHandler{notes: store.Notes, projects: projects, quotas: quotas}
	ctx := context.Background()
	note := &domain.Note{UserID: 1, Body: "valid"}
	if err := store.Notes.Create(ctx, note); err != nil {
		t.Fatal(err)
	}

	body := `{"body":"` + strings.Repeat("x", service.MaxNotesCharacters+1) + `"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/notes/1", bytes.NewBufferString(body))
	req.SetPathValue("id", strconv.FormatInt(note.ID, 10))
	req = req.WithContext(context.WithValue(req.Context(), ctxKeyClaims, &auth.Claims{UserID: 1}))
	rec := httptest.NewRecorder()

	h.update(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
