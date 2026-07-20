// Package web embeds the built frontend (Vite output) for single-binary serving.
// The Vite build writes to ./dist (configured in ui/vite.config.ts).
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// FS returns the built SPA as an fs.FS rooted at the dist directory.
// It returns nil if the frontend has not been built yet (only the placeholder).
func FS() fs.FS {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil
	}
	return sub
}
