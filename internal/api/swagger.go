package api

import (
	"fmt"
	"net/http"
	"sync"

	_ "github.com/jdel/gotracks/internal/docs"
	httpSwagger "github.com/swaggo/http-swagger/v2"
)

// urlMutatorScript rewrites the OpenAPI spec's scheme and host on UI load so
// "Try it out" hits the right origin behind a reverse proxy or over TLS.
const urlMutatorScript = `const UrlMutatorPlugin = (system) => ({
  rootInjects: {
    setScheme: (scheme) => {
      const jsonSpec = system.getState().toJSON().spec.json;
      const schemes = Array.isArray(scheme) ? scheme : [scheme];
      const newJsonSpec = Object.assign({}, jsonSpec, { schemes });
      return system.specActions.updateJsonSpec(newJsonSpec);
    },
    setHost: (host) => {
      const jsonSpec = system.getState().toJSON().spec.json;
      const newJsonSpec = Object.assign({}, jsonSpec, { host });
      return system.specActions.updateJsonSpec(newJsonSpec);
    }
  }
});`

// swaggerHandlers registers /doc and /doc/* on mux (no auth required).
// httpSwagger.Handler builds a fresh handler per call, so we cache one per
// distinct (scheme, host) pair instead of rebuilding on every request.
func swaggerHandlers(mux *http.ServeMux, secure bool) {
	var cache sync.Map // map[string]http.Handler, key "<scheme>|<host>"
	build := func(scheme, host string) http.Handler {
		return httpSwagger.Handler(
			httpSwagger.URL("/doc/doc.json"),
			httpSwagger.BeforeScript(urlMutatorScript),
			httpSwagger.Plugins([]string{"UrlMutatorPlugin"}),
			httpSwagger.UIConfig(map[string]string{
				"onComplete": fmt.Sprintf(`() => {
  window.ui.setScheme('%s');
  window.ui.setHost('%s');
}`, scheme, host),
			}),
		)
	}

	mux.Handle("GET /doc/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/doc/" {
			http.Redirect(w, r, "/doc/index.html", http.StatusMovedPermanently)
			return
		}
		scheme := "http"
		if secure || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		key := scheme + "|" + r.Host
		h, ok := cache.Load(key)
		if !ok {
			h, _ = cache.LoadOrStore(key, build(scheme, r.Host))
		}
		h.(http.Handler).ServeHTTP(w, r)
	}))
	mux.HandleFunc("GET /doc", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/doc/index.html", http.StatusMovedPermanently)
	})
}
