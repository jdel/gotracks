package service_test

import (
	"path/filepath"
	"testing"

	"github.com/jdel/gotracks/internal/storage"
)

// testStore builds a local (in-process S3) attachment store over a temp dir.
func testStore(t *testing.T) storage.Store {
	t.Helper()
	s, _ := testStoreDir(t)
	return s
}

// testStoreDir also returns the directory the object bytes land in, so a test
// can assert how many files remain after a deletion. Local mode writes one
// file per object at <dir>/blob/<key>.
func testStoreDir(t *testing.T) (storage.Store, string) {
	t.Helper()
	dir := t.TempDir()
	s, err := storage.New(storage.Config{Dir: dir})
	if err != nil {
		t.Fatalf("build store: %v", err)
	}
	return s, filepath.Join(dir, "blob")
}
