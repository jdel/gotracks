package api

import (
	"context"
	"database/sql"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/db"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func newTestStore(t *testing.T) *repo.Store {
	t.Helper()
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
	return repo.NewStore(bdb)
}

// countingReader records how much of the request body the server consumes.
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { return len(p), nil }

// FormFile parses (and spools to disk) the entire multipart body before the
// service can apply its limit, so the body has to be capped up front.
func TestUploadStopsReadingPastTheLimit(t *testing.T) {
	const maxBytes = 1 << 20 // 1 MiB configured limit
	const bodySize = 64 << 20

	ctx := context.Background()
	store := newTestStore(t)

	c := &domain.Context{UserID: 1, Name: "@home", Position: 1, State: domain.StateActive}
	if err := store.Contexts.Create(ctx, c); err != nil {
		t.Fatal(err)
	}
	todo := &domain.Todo{
		UserID: 1, ContextID: c.ID, Description: "holds files", State: domain.StateActive,
	}
	if err := store.Todos.Create(ctx, todo); err != nil {
		t.Fatal(err)
	}

	svc := service.NewAttachmentService(store.Attachments, store.Todos, t.TempDir(), maxBytes)
	h := &attachmentHandler{attachments: svc}

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		part, err := mw.CreateFormFile("file", "big.bin")
		if err != nil {
			pw.CloseWithError(err)
			return
		}
		// Writes fail once the server stops reading; that is the point.
		if _, err := io.CopyN(part, zeroReader{}, bodySize); err != nil {
			pw.CloseWithError(err)
			return
		}
		mw.Close()
		pw.Close()
	}()

	body := &countingReader{r: pr}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/todos/1/attachments", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.SetPathValue("id", "1")
	req = req.WithContext(context.WithValue(req.Context(), ctxKeyClaims, &auth.Claims{UserID: 1}))

	rec := httptest.NewRecorder()
	h.upload(rec, req)

	if rec.Code == http.StatusCreated {
		t.Fatalf("a %d-byte upload was accepted under a %d-byte limit", bodySize, maxBytes)
	}
	if body.n > maxBytes+(2<<20) {
		t.Fatalf("server consumed %d bytes of a body limited to %d", body.n, maxBytes)
	}
}

// An upload within the limit still works.
func TestUploadWithinLimitSucceeds(t *testing.T) {
	const maxBytes = 1 << 20

	ctx := context.Background()
	store := newTestStore(t)

	c := &domain.Context{UserID: 1, Name: "@home", Position: 1, State: domain.StateActive}
	if err := store.Contexts.Create(ctx, c); err != nil {
		t.Fatal(err)
	}
	todo := &domain.Todo{
		UserID: 1, ContextID: c.ID, Description: "holds files", State: domain.StateActive,
	}
	if err := store.Todos.Create(ctx, todo); err != nil {
		t.Fatal(err)
	}

	svc := service.NewAttachmentService(store.Attachments, store.Todos, t.TempDir(), maxBytes)
	h := &attachmentHandler{attachments: svc}

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		part, err := mw.CreateFormFile("file", "small.txt")
		if err != nil {
			pw.CloseWithError(err)
			return
		}
		io.WriteString(part, "hello")
		mw.Close()
		pw.Close()
	}()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/todos/1/attachments", pr)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.SetPathValue("id", "1")
	req = req.WithContext(context.WithValue(req.Context(), ctxKeyClaims, &auth.Claims{UserID: 1}))

	rec := httptest.NewRecorder()
	h.upload(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("small upload rejected: status %d body %s", rec.Code, rec.Body.String())
	}
}
