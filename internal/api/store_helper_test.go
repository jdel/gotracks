package api

import (
	"testing"

	"github.com/jdel/gotracks/internal/storage"
)

// testStore builds a local (in-process S3) attachment store over a temp dir.
func testStore(t *testing.T) storage.Store {
	t.Helper()
	s, err := storage.New(storage.Config{Dir: t.TempDir()})
	if err != nil {
		t.Fatalf("build store: %v", err)
	}
	return s
}
