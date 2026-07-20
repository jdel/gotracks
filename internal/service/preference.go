package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// SupportedLocales are the languages the interface ships translations for.
// The UI offers exactly these, and anything else is refused rather than
// stored: a preference nothing can render is worse than the default.
var SupportedLocales = []string{"en", "fr"}

// NormaliseLocale reduces a locale tag to one the interface can render.
//
// A regional tag keeps only its language ("fr-CA" -> "fr"), since the
// translations are language-wide. Anything still unrecognised — a browser
// sending a language nothing is translated into, or a hand-written value —
// becomes the default rather than an error, because this runs on the
// registration path where refusing a signup over a display setting would be
// absurd.
func NormaliseLocale(code string) string {
	code = strings.ToLower(strings.TrimSpace(code))
	if i := strings.IndexAny(code, "-_"); i > 0 {
		code = code[:i]
	}
	if slices.Contains(SupportedLocales, code) {
		return code
	}
	return "en"
}

// DefaultPreference is returned for users who have never saved settings.
func DefaultPreference(userID int64) *domain.Preference {
	return &domain.Preference{
		UserID:       userID,
		DateFormat:   "2006-01-02",
		TimeZone:     "UTC",
		Locale:       "en",
		Theme:        "system",
		WeekStart:    1,
		ReviewPeriod: 7,
	}
}

// PreferenceService reads and writes user display settings.
type PreferenceService struct {
	prefs repo.PreferenceRepo
}

// NewPreferenceService builds a PreferenceService.
func NewPreferenceService(prefs repo.PreferenceRepo) *PreferenceService {
	return &PreferenceService{prefs: prefs}
}

// Get returns the user's preferences, falling back to defaults.
func (s *PreferenceService) Get(ctx context.Context, userID int64) (*domain.Preference, error) {
	p, err := s.prefs.Get(ctx, userID)
	if errors.Is(err, repo.ErrNotFound) {
		return DefaultPreference(userID), nil
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

// PreferenceInput carries partial updates; nil means "leave unchanged".
type PreferenceInput struct {
	DateFormat            *string
	TimeZone              *string
	Locale                *string
	Theme                 *string
	WeekStart             *int
	ReviewPeriod          *int
	AutoDeleteAttachments *bool
}

// Update merges the input into the stored preferences.
func (s *PreferenceService) Update(ctx context.Context, userID int64, in PreferenceInput) (*domain.Preference, error) {
	p, err := s.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
	if in.DateFormat != nil {
		p.DateFormat = *in.DateFormat
	}
	if in.TimeZone != nil {
		// Reject a timezone the server cannot load, so formatting never breaks later.
		if _, err := time.LoadLocation(*in.TimeZone); err != nil {
			return nil, ErrValidation
		}
		p.TimeZone = *in.TimeZone
	}
	if in.Locale != nil {
		// Refused rather than normalised: this comes from the settings picker,
		// which only ever offers supported values, so anything else is a bug or
		// a hand-crafted request and should not be stored silently.
		if !slices.Contains(SupportedLocales, *in.Locale) {
			return nil, ErrValidation
		}
		p.Locale = *in.Locale
	}
	if in.Theme != nil {
		switch *in.Theme {
		case "light", "dark", "system":
			p.Theme = *in.Theme
		default:
			return nil, ErrValidation
		}
	}
	if in.WeekStart != nil {
		if *in.WeekStart < 0 || *in.WeekStart > 6 {
			return nil, ErrValidation
		}
		p.WeekStart = *in.WeekStart
	}
	if in.ReviewPeriod != nil {
		if *in.ReviewPeriod < 1 {
			return nil, ErrValidation
		}
		p.ReviewPeriod = *in.ReviewPeriod
	}
	if in.AutoDeleteAttachments != nil {
		p.AutoDeleteAttachments = in.AutoDeleteAttachments
	}
	p.UpdatedAt = time.Now()
	if err := s.prefs.Upsert(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}
