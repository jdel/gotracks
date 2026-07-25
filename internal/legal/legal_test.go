package legal_test

import (
	"strings"
	"testing"

	"github.com/jdel/gotracks/internal/legal"
)

func TestDefaultsShipForEveryLocaleAndKind(t *testing.T) {
	for _, locale := range []string{"en", "fr", "it", "de"} {
		for _, kind := range legal.Kinds {
			body := legal.Default(locale, kind)
			if strings.TrimSpace(body) == "" {
				t.Fatalf("%s/%s ships empty", locale, kind)
			}
			if !strings.Contains(body, "{{CONTACT_EMAIL}}") {
				t.Errorf("%s/%s lost the operator placeholder", locale, kind)
			}
		}
	}
	// A language with no translation still gets a complete document.
	if legal.Default("ja", legal.Terms) != legal.Default("en", legal.Terms) {
		t.Error("an untranslated locale did not fall back to English")
	}
}
