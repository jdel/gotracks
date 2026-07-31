package api

import (
	"net/http"

	_ "github.com/jdel/gotracks/internal/docs"
	httpSwagger "github.com/swaggo/http-swagger/v2"
)

// swaggerHandlers registers /doc and /doc/* on mux behind auth.
//
// The interactive docs are gated so they are not an unauthenticated surface.
// The OpenAPI spec carries no host and no schemes (SwaggerInfo.Host is empty),
// so swagger-ui aims "Try it out" at the browser's own origin — correct behind a
// reverse proxy or TLS without the server reading, reflecting, or caching the
// request Host. One handler serves every request: nothing varies per Host, so
// there is nothing to cache and no Host value ever reaches the page.
func swaggerHandlers(mux *http.ServeMux, protect func(http.Handler) http.Handler) {
	doc := httpSwagger.Handler(httpSwagger.URL("/doc/doc.json"))

	mux.Handle("GET /doc/", protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/doc/" {
			http.Redirect(w, r, "/doc/index.html", http.StatusMovedPermanently)
			return
		}
		doc.ServeHTTP(w, r)
	})))
	mux.Handle("GET /doc", protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/doc/index.html", http.StatusMovedPermanently)
	})))
}
