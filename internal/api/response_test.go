package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONRequiresExactlyOneValue(t *testing.T) {
	type body struct {
		Name string `json:"name"`
	}
	cases := []struct {
		name string
		in   string
		ok   bool
	}{
		{"single object", `{"name":"first"}`, true},
		{"trailing whitespace is fine", "{\"name\":\"first\"}\n  ", true},
		{"second json value", `{"name":"first"}{"name":"second"}`, false},
		{"trailing garbage", `{"name":"first"} nope`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.in))
			rec := httptest.NewRecorder()
			var dst body
			got := decodeJSON(rec, req, &dst)
			if got != tc.ok {
				t.Fatalf("decodeJSON = %v, want %v", got, tc.ok)
			}
			if !tc.ok && rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
		})
	}
}
