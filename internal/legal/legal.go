// Package legal owns the text of the terms, privacy and cookie documents that
// the binary ships with.
//
// They live here rather than in the frontend so the server can serve them in
// the reader's language and fall back when a translation is missing, and so an
// operator's replacement is a database row over a known baseline rather than a
// copy of a string nobody can diff against the code.
package legal

import (
	"embed"
	"fmt"
)

//go:embed defaults/*/*.md
var defaults embed.FS

// Document kinds.
const (
	Terms   = "terms"
	Privacy = "privacy"
	Cookies = "cookies"
)

// Kinds lists every document, in the order they are presented and hashed.
var Kinds = []string{Terms, Privacy, Cookies}

// ValidKind reports whether kind names a document.
func ValidKind(kind string) bool {
	for _, k := range Kinds {
		if k == kind {
			return true
		}
	}
	return false
}

// Default returns the shipped draft for a locale, falling back to English so a
// language with no translation still shows a complete document.
func Default(locale, kind string) string {
	if body, err := defaults.ReadFile(fmt.Sprintf("defaults/%s/%s.md", locale, kind)); err == nil {
		return string(body)
	}
	body, _ := defaults.ReadFile(fmt.Sprintf("defaults/en/%s.md", kind))
	return string(body)
}
