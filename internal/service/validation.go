package service

import (
	"strings"
	"unicode/utf8"
)

// User-authored text limits are measured in Unicode characters. UTF-8 uses at
// most four bytes per character, so these also place a deterministic ceiling
// on database growth without making non-ASCII text consume the allowance
// faster.
const (
	MaxNameCharacters        = 200
	MaxDescriptionCharacters = 1000
	MaxNotesCharacters       = 1000
	MaxFileNameCharacters    = 200
	MaxContentTypeCharacters = 200
)

func withinCharacters(value string, maxCharacters int) bool {
	return utf8.RuneCountInString(value) <= maxCharacters
}

func validateRequired(value string, maxCharacters int) error {
	if strings.TrimSpace(value) == "" || !withinCharacters(value, maxCharacters) {
		return ErrValidation
	}
	return nil
}

func validateOptional(value *string, maxCharacters int) error {
	if value != nil && !withinCharacters(*value, maxCharacters) {
		return ErrValidation
	}
	return nil
}

func validateName(value string) error {
	return validateRequired(value, MaxNameCharacters)
}

// ValidateNoteBody validates note text at the API boundary. Notes currently
// use the repository directly, unlike the other resources whose service owns
// this check.
func ValidateNoteBody(value string) error {
	return validateRequired(value, MaxNotesCharacters)
}
