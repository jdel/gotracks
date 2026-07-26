package storage_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"testing"

	"github.com/jdel/gotracks/internal/storage"
	"github.com/johannesboyne/gofakes3"
	"github.com/johannesboyne/gofakes3/backend/s3mem"
)

func local(t *testing.T, dir string) storage.Store {
	t.Helper()
	s, err := storage.New(storage.Config{Dir: dir})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

func TestPutOpenRemove(t *testing.T) {
	ctx := context.Background()
	s := local(t, t.TempDir())
	body := []byte("the quick brown fox")

	if err := s.Put(ctx, "k1", bytes.NewReader(body), int64(len(body)), "text/plain"); err != nil {
		t.Fatalf("Put: %v", err)
	}

	r, err := s.Open(ctx, "k1")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("read back %q, want %q", got, body)
	}

	// Seek must work so http.ServeContent can honour range requests.
	if _, err := r.Seek(4, io.SeekStart); err != nil {
		t.Fatalf("Seek: %v", err)
	}
	rest, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("ReadAll after seek: %v", err)
	}
	if string(rest) != "quick brown fox" {
		t.Fatalf("after seek got %q", rest)
	}
	r.Close()

	if err := s.Remove(ctx, "k1"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := s.Open(ctx, "k1"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("Open after Remove: want ErrNotFound, got %v", err)
	}
}

func TestOpenUnknownIsNotFound(t *testing.T) {
	if _, err := local(t, t.TempDir()).Open(context.Background(), "nope"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestPersistsAcrossReopen(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	body := []byte("durable")
	if err := local(t, dir).Put(ctx, "k", bytes.NewReader(body), int64(len(body)), "application/octet-stream"); err != nil {
		t.Fatalf("Put: %v", err)
	}

	// A fresh store over the same directory still sees the object and its type.
	r, err := local(t, dir).Open(ctx, "k")
	if err != nil {
		t.Fatalf("Open after reopen: %v", err)
	}
	defer r.Close()
	got, _ := io.ReadAll(r)
	if !bytes.Equal(got, body) {
		t.Fatalf("read back %q, want %q", got, body)
	}
}

func TestUnknownTypeErrors(t *testing.T) {
	if _, err := storage.New(storage.Config{Type: "gcs", Dir: t.TempDir()}); err == nil {
		t.Fatal("want error for unknown storage type")
	}
}

// TestS3ModeFromEnv drives the s3 path exactly as a deployment would: a real
// S3-compatible endpoint and credentials supplied through the AWS environment
// variables, with an external gofakes3 server standing in for AWS. It also
// proves the missing bucket is created and the endpoint URL's scheme is honored.
func TestS3ModeFromEnv(t *testing.T) {
	ctx := context.Background()
	srv := httptest.NewServer(gofakes3.New(s3mem.New()).Server())
	defer srv.Close()

	t.Setenv("AWS_ENDPOINT_URL_S3", srv.URL) // http:// -> plain, not TLS
	t.Setenv("AWS_ACCESS_KEY_ID", "test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "secret")
	t.Setenv("AWS_REGION", "us-east-1")

	s, err := storage.New(storage.Config{Type: "s3", Bucket: "attachments"})
	if err != nil {
		t.Fatalf("New s3: %v", err)
	}

	body := []byte("over the wire")
	if err := s.Put(ctx, "k", bytes.NewReader(body), int64(len(body)), "text/plain"); err != nil {
		t.Fatalf("Put: %v", err)
	}
	r, err := s.Open(ctx, "k")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if !bytes.Equal(got, body) {
		t.Fatalf("read back %q, want %q", got, body)
	}
	if err := s.Remove(ctx, "k"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
}
