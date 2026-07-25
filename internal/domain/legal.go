package domain

import (
	"time"

	"github.com/uptrace/bun"
)

// LegalDocument is the operator's replacement for one shipped document, in one
// language. Saving one publishes it: readers see it immediately.
//
// Only replacements are stored. The text the binary ships with lives in the
// legal package, so an instance nobody has edited holds no rows and resetting a
// document is a delete rather than a copy of the shipped text that would then
// go stale against the code.
type LegalDocument struct {
	bun.BaseModel `bun:"table:legal_documents,alias:legal"`

	Locale    string    `bun:"locale,pk" json:"locale"`
	Kind      string    `bun:"kind,pk" json:"kind"`
	Body      string    `bun:"body,notnull" json:"body"`
	UpdatedAt time.Time `bun:"updated_at,notnull" json:"updatedAt"`
}

// LegalAcceptance records that an account agreed to the documents when it was
// created.
//
// One row per account, written at registration and never revisited: the
// documents say they may change and that anyone who disagrees can delete their
// account, so continued use is the mechanism after that rather than a fresh
// click. It exists so the agreement is evidenced rather than merely asserted.
type LegalAcceptance struct {
	bun.BaseModel `bun:"table:legal_acceptances,alias:lacc"`

	UserID     int64     `bun:"user_id,pk" json:"-"`
	AcceptedAt time.Time `bun:"accepted_at,notnull" json:"acceptedAt"`
}
