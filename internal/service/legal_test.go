package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jdel/gotracks/internal/legal"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

func legalFixture(t *testing.T) (*service.LegalService, *repo.Store) {
	t.Helper()
	_, store, _ := newTodoService(t)
	return service.NewLegalService(store.Legal), store
}

func bodyOf(t *testing.T, svc *service.LegalService, locale, kind string) service.Document {
	t.Helper()
	docs, err := svc.Documents(context.Background(), locale)
	if err != nil {
		t.Fatal(err)
	}
	for _, doc := range docs {
		if doc.Kind == kind {
			return doc
		}
	}
	t.Fatalf("no document of kind %q", kind)
	return service.Document{}
}

// An instance nobody has edited serves the text shipped in the binary, with no
// rows to seed and nothing to publish.
func TestShippedTextIsServedUntilEdited(t *testing.T) {
	svc, store := legalFixture(t)
	ctx := context.Background()

	doc := bodyOf(t, svc, "en", legal.Terms)
	if doc.Customised {
		t.Error("a fresh instance reports a customised document")
	}
	if !strings.Contains(doc.Body, "Terms of service") {
		t.Errorf("shipped terms not served: %.40s", doc.Body)
	}
	stored, err := store.Legal.Documents(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) != 0 {
		t.Errorf("a fresh instance stored %d rows", len(stored))
	}
}

// Saving publishes: there is no draft step between the editor and the reader.
func TestSavingIsImmediatelyServed(t *testing.T) {
	svc, _ := legalFixture(t)
	ctx := context.Background()

	if err := svc.Save(ctx, "en", legal.Privacy, "# Privacy\n\nHouse privacy.\n"); err != nil {
		t.Fatal(err)
	}
	doc := bodyOf(t, svc, "en", legal.Privacy)
	if !strings.Contains(doc.Body, "House privacy") {
		t.Errorf("the saved text was not served: %.40s", doc.Body)
	}
	if !doc.Customised {
		t.Error("an edited document is not reported as customised")
	}
	// Editing one language leaves the others on the shipped text.
	if fr := bodyOf(t, svc, "fr", legal.Privacy); fr.Customised {
		t.Error("editing English marked the French document customised")
	}
}

// Clearing the editor means "use the shipped text", not "publish a blank
// policy".
func TestEmptyBodyRestoresTheShippedText(t *testing.T) {
	svc, _ := legalFixture(t)
	ctx := context.Background()

	if err := svc.Save(ctx, "en", legal.Cookies, "# Cookies\n\nHouse cookies.\n"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Save(ctx, "en", legal.Cookies, ""); err != nil {
		t.Fatal(err)
	}
	doc := bodyOf(t, svc, "en", legal.Cookies)
	if doc.Customised {
		t.Error("a reset document is still reported as customised")
	}
	if !strings.Contains(doc.Body, "sets no cookies") {
		t.Errorf("the shipped cookie policy was not restored: %.40s", doc.Body)
	}
}

// Documents are served in the reader's language, falling back rather than
// showing nothing.
func TestDocumentsFollowTheLocale(t *testing.T) {
	svc, _ := legalFixture(t)
	ctx := context.Background()

	for locale, want := range map[string]string{
		"fr": "Conditions",
		"it": "Condizioni",
		"de": "Nutzungsbedingungen",
	} {
		doc := bodyOf(t, svc, locale, legal.Terms)
		if !strings.Contains(doc.Body, want) {
			t.Errorf("%s terms not served: %.40s", locale, doc.Body)
		}
	}
	if _, err := svc.Documents(ctx, "ja"); err != nil {
		t.Fatal(err)
	}
	if doc := bodyOf(t, svc, "ja", legal.Terms); !strings.Contains(doc.Body, "Terms of service") {
		t.Errorf("an unsupported locale did not fall back to English: %.40s", doc.Body)
	}
}

// Agreement is captured once, when the account is created.
func TestAcceptanceIsRecordedOncePerAccount(t *testing.T) {
	svc, store := legalFixture(t)
	ctx := context.Background()

	if _, err := store.Legal.AcceptanceForUser(ctx, 1); !errors.Is(err, repo.ErrNotFound) {
		t.Fatalf("an account that never agreed has a record: %v", err)
	}
	if err := svc.Accept(ctx, 1); err != nil {
		t.Fatal(err)
	}
	first, err := store.Legal.AcceptanceForUser(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	// A retried registration must not fail or move the date.
	if err := svc.Accept(ctx, 1); err != nil {
		t.Fatalf("re-accepting failed: %v", err)
	}
	again, err := store.Legal.AcceptanceForUser(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !again.AcceptedAt.Equal(first.AcceptedAt) {
		t.Error("a retried registration moved the recorded date")
	}
}

func TestUnknownKindOrLocaleIsRefused(t *testing.T) {
	svc, _ := legalFixture(t)
	ctx := context.Background()
	if err := svc.Save(ctx, "en", "imprint", "x"); err == nil {
		t.Error("an unknown document kind was stored")
	}
	if err := svc.Save(ctx, "ja", legal.Terms, "x"); err == nil {
		t.Error("an unsupported locale was stored")
	}
}
