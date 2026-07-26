package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/storage"
)

// ErrTooLarge is returned when an upload exceeds the configured limit.
var ErrTooLarge = fmt.Errorf("file too large")

// AttachmentService stores uploaded files in an object store and their
// metadata in the DB.
type AttachmentService struct {
	quotas      *QuotaService
	attachments repo.AttachmentRepo
	todos       repo.TodoRepo
	store       storage.Store
	maxBytes    int64
}

// SetQuotas enables the per-account storage allowance. Set separately so the
// constructor signature stays stable; nil leaves storage unlimited.
func (s *AttachmentService) SetQuotas(q *QuotaService) { s.quotas = q }

// NewAttachmentService builds an AttachmentService backed by store.
func NewAttachmentService(a repo.AttachmentRepo, todos repo.TodoRepo, store storage.Store, maxBytes int64) *AttachmentService {
	return &AttachmentService{attachments: a, todos: todos, store: store, maxBytes: maxBytes}
}

// MaxBytes returns the per-file upload limit, so the HTTP layer can refuse to
// read a body larger than what could ever be stored.
func (s *AttachmentService) MaxBytes() int64 { return s.maxBytes }

// List returns the attachments of a todo.
func (s *AttachmentService) List(ctx context.Context, userID, todoID int64) ([]*domain.Attachment, error) {
	if _, err := s.todos.ByID(ctx, userID, todoID); err != nil {
		return nil, err
	}
	return s.attachments.ListForTodo(ctx, userID, todoID)
}

// ListAll returns every attachment for the account, each carrying its todo's
// description and state, for the attachments-overview page.
func (s *AttachmentService) ListAll(ctx context.Context, userID int64) ([]*domain.AttachmentWithTodo, error) {
	return s.attachments.ListForUser(ctx, userID)
}

// Save streams an upload to the store and records its metadata.
func (s *AttachmentService) Save(
	ctx context.Context, userID, todoID int64, fileName, contentType string, src io.Reader,
) (*domain.Attachment, error) {
	fileName = filepath.Base(fileName)
	if err := validateRequired(fileName, MaxFileNameCharacters); err != nil {
		return nil, err
	}
	if !withinCharacters(contentType, MaxContentTypeCharacters) {
		return nil, ErrValidation
	}
	if _, err := s.todos.ByID(ctx, userID, todoID); err != nil {
		return nil, err
	}
	// Refuse early when the account is already at its allowance, so an upload
	// that cannot possibly be kept is not streamed to the store first.
	if err := s.quotas.CheckStorage(ctx, userID, 0); err != nil {
		return nil, err
	}

	// Read the upload into memory behind a limit one byte past the maximum, so
	// an oversized file is rejected before anything is stored, and the exact
	// size is known for the object's Content-Length. The bound keeps this from
	// being a memory-exhaustion vector: MaxUploadBytes caps it.
	data, err := io.ReadAll(io.LimitReader(src, s.maxBytes+1))
	if err != nil {
		return nil, err
	}
	written := int64(len(data))
	if written > s.maxBytes {
		return nil, ErrTooLarge
	}

	idBuf := make([]byte, 16)
	if _, err := rand.Read(idBuf); err != nil {
		return nil, err
	}
	stored := hex.EncodeToString(idBuf)

	if err := s.store.Put(ctx, stored, bytes.NewReader(data), written, contentType); err != nil {
		return nil, err
	}
	a := &domain.Attachment{
		UserID:      userID,
		TodoID:      todoID,
		FileName:    fileName,
		ContentType: contentType,
		Size:        written,
		StoredName:  stored,
		CreatedAt:   time.Now(),
	}
	// The real size is only known now, so the allowance is checked again with
	// it and the file removed if it would not fit. Only this pair is guarded,
	// not the upload itself: holding an account's lock for the length of a
	// transfer would let one slow client stall its own writes for minutes.
	if err := s.quotas.Guard(ctx, userID, func(ctx context.Context) error {
		if err := s.quotas.CheckStorage(ctx, userID, written); err != nil {
			return err
		}
		return s.attachments.Create(ctx, a)
	}); err != nil {
		_ = s.store.Remove(ctx, stored)
		return nil, err
	}
	return a, nil
}

// Open returns the metadata and a readable, seekable handle for download.
func (s *AttachmentService) Open(ctx context.Context, userID, id int64) (*domain.Attachment, io.ReadSeekCloser, error) {
	a, err := s.attachments.ByID(ctx, userID, id)
	if err != nil {
		return nil, nil, err
	}
	r, err := s.store.Open(ctx, a.StoredName)
	if errors.Is(err, storage.ErrNotFound) {
		// The row exists but the object behind it does not — orphaned or
		// placeholder metadata. Same response as an unknown attachment: there
		// is nothing here to serve either way.
		return nil, nil, repo.ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	return a, r, nil
}

// Delete removes an attachment and its stored object.
func (s *AttachmentService) Delete(ctx context.Context, userID, id int64) error {
	a, err := s.attachments.ByID(ctx, userID, id)
	if err != nil {
		return err
	}
	if err := s.attachments.Delete(ctx, userID, id); err != nil {
		return err
	}
	// The row is gone; a leftover object is harmless but we clean up anyway.
	_ = s.store.Remove(ctx, a.StoredName)
	return nil
}

// DeleteForTodo removes every attachment belonging to a todo.
func (s *AttachmentService) DeleteForTodo(ctx context.Context, userID, todoID int64) error {
	removed, err := s.attachments.DeleteForTodo(ctx, userID, todoID)
	if err != nil {
		return err
	}
	for _, a := range removed {
		_ = s.store.Remove(ctx, a.StoredName)
	}
	return nil
}

// DeleteForUser removes every attachment belonging to a user, files included.
func (s *AttachmentService) DeleteForUser(ctx context.Context, userID int64) error {
	removed, err := s.attachments.DeleteForUser(ctx, userID)
	if err != nil {
		return err
	}
	for _, a := range removed {
		_ = s.store.Remove(ctx, a.StoredName)
	}
	return nil
}
