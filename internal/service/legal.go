package service

import (
	"context"
	"slices"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/legal"
	"github.com/jdel/gotracks/internal/repo"
)

// MaxLegalBodyCharacters bounds one document. Legal texts are long, but they
// are operator-supplied and stored indefinitely, so they are not unbounded.
const MaxLegalBodyCharacters = 200_000

// LegalService serves the terms, privacy and cookie documents and records that
// an account agreed to them when it was created.
//
// Saving publishes: there is no draft, no version and no re-consent. The
// documents themselves say they may change and that anyone who disagrees can
// delete their account, which is the mechanism after registration.
type LegalService struct {
	legal repo.LegalRepo
}

// NewLegalService builds the service.
func NewLegalService(l repo.LegalRepo) *LegalService { return &LegalService{legal: l} }

// Document is one legal document as readers see it.
type Document struct {
	Kind string `json:"kind"`
	Body string `json:"body"`
	// Customised reports whether the operator replaced the shipped text, so the
	// editor can offer to put it back.
	Customised bool `json:"customised"`
}

// Documents returns every document in one language: the operator's replacement
// where there is one, the shipped text otherwise.
func (s *LegalService) Documents(ctx context.Context, locale string) ([]Document, error) {
	if !slices.Contains(SupportedLocales, locale) {
		locale = SupportedLocales[0]
	}
	stored, err := s.legal.Documents(ctx)
	if err != nil {
		return nil, err
	}
	replaced := map[string]string{}
	for _, doc := range stored {
		if doc.Locale == locale {
			replaced[doc.Kind] = doc.Body
		}
	}
	out := make([]Document, 0, len(legal.Kinds))
	for _, kind := range legal.Kinds {
		body, customised := replaced[kind]
		if !customised {
			body = legal.Default(locale, kind)
		}
		out = append(out, Document{Kind: kind, Body: body, Customised: customised})
	}
	return out, nil
}

// Overrides returns every stored replacement, keyed by locale then kind, for
// the operator's editor.
func (s *LegalService) Overrides(ctx context.Context) (map[string]map[string]string, error) {
	docs, err := s.legal.Documents(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]map[string]string{}
	for _, doc := range docs {
		if out[doc.Locale] == nil {
			out[doc.Locale] = map[string]string{}
		}
		out[doc.Locale][doc.Kind] = doc.Body
	}
	return out, nil
}

// Default returns the shipped text, so the editor can offer to reset to it.
func (s *LegalService) Default(locale, kind string) string { return legal.Default(locale, kind) }

// Save replaces one document in one language. Readers see it immediately.
//
// An empty body resets to the shipped text: storing "" would publish a blank
// policy, which is never what clearing a field means.
func (s *LegalService) Save(ctx context.Context, locale, kind, body string) error {
	if !legal.ValidKind(kind) || !slices.Contains(SupportedLocales, locale) {
		return ErrValidation
	}
	if !withinCharacters(body, MaxLegalBodyCharacters) {
		return ErrValidation
	}
	if body == "" {
		return s.Reset(ctx, locale, kind)
	}
	return s.legal.Put(ctx, &domain.LegalDocument{Locale: locale, Kind: kind, Body: body})
}

// Reset drops a replacement so the shipped text applies again.
func (s *LegalService) Reset(ctx context.Context, locale, kind string) error {
	if !legal.ValidKind(kind) || !slices.Contains(SupportedLocales, locale) {
		return ErrValidation
	}
	return s.legal.Delete(ctx, locale, kind)
}

// Accept records that an account agreed at registration.
func (s *LegalService) Accept(ctx context.Context, userID int64) error {
	return s.legal.Accept(ctx, userID)
}

// AcceptanceForUser returns when the account agreed, for the data export. A
// nil result means it never did, which is every account created before the
// documents were switched on.
func (s *LegalService) AcceptanceForUser(ctx context.Context, userID int64) (*domain.LegalAcceptance, error) {
	row, err := s.legal.AcceptanceForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return row, nil
}
