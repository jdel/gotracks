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

// swaggerHandlers registers /doc and /doc/* on mux behind auth.
//
// The interactive docs are gated so they are not an unauthenticated surface:
// the handler caches one instance per request Host, and reflects the Host into
// its config script — behind auth, only a signed-in caller can reach either,
// so an anonymous client can neither grow that cache nor influence the script.
// (The app authenticates with a Bearer token, so the UI is reached with a token
// from an API tool, not by plain browser navigation.)
//
// httpSwagger.Handler builds a fresh handler per call, so we cache one per
// distinct (scheme, host) pair instead of rebuilding on every request.
func swaggerHandlers(mux *http.ServeMux, secure bool, protect func(http.Handler) http.Handler) {
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

	mux.Handle("GET /doc/", protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	})))
	mux.Handle("GET /doc", protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/doc/index.html", http.StatusMovedPermanently)
	})))
}
