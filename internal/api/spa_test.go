package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

// An unmatched /api/ path must be a real 404, not the SPA served with a 200.
// A client hitting a removed or mistyped endpoint would otherwise parse the
// HTML entrypoint as if it were the JSON it asked for.
func TestSPAHandlerRejectsUnknownAPIPaths(t *testing.T) {
	fs := fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}}
	h := spaHandler(fs)

	t.Run("unknown api path is 404 json", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/never-existed", nil))

		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("content-type = %q, want application/json", ct)
		}
	})

	t.Run("client route falls back to the SPA", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/projects/42", nil))

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
		if body := rec.Body.String(); body != "<!doctype html>" {
			t.Errorf("body = %q, want the SPA entrypoint", body)
		}
	})
}

// The fonts are self-hosted under /static/fonts/, which the cookie policy
// depends on — nothing may be fetched from a third-party domain. A path that
// silently fell through to index.html would leave the browser parsing HTML as
// a font and quietly falling back to a system face.
func TestSPAHandlerServesTheSelfHostedFonts(t *testing.T) {
	fs := fstest.MapFS{
		"index.html": {Data: []byte("<!doctype html>")},
		"static/fonts/manrope-latin-wght-normal.woff2": {Data: []byte("wOF2")},
	}
	h := spaHandler(fs)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/fonts/manrope-latin-wght-normal.woff2", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "wOF2" {
		t.Fatalf("body = %q, want the font bytes rather than the SPA", body)
	}
}
