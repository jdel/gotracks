package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// ErrTooLarge is returned when an upload exceeds the configured limit.
var ErrTooLarge = fmt.Errorf("file too large")

// AttachmentService stores uploaded files on disk and their metadata in the DB.
type AttachmentService struct {
	quotas      *QuotaService
	attachments repo.AttachmentRepo
	todos       repo.TodoRepo
	dir         string
	maxBytes    int64
}

// SetQuotas enables the per-account storage allowance. Set separately so the
// constructor signature stays stable; nil leaves storage unlimited.
func (s *AttachmentService) SetQuotas(q *QuotaService) { s.quotas = q }

// NewAttachmentService builds an AttachmentService rooted at dir.
func NewAttachmentService(a repo.AttachmentRepo, todos repo.TodoRepo, dir string, maxBytes int64) *AttachmentService {
	return &AttachmentService{attachments: a, todos: todos, dir: dir, maxBytes: maxBytes}
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

// Save streams an upload to disk and records its metadata.
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
	// that cannot possibly be kept is not streamed to disk first.
	if err := s.quotas.CheckStorage(ctx, userID, 0); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}

	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	stored := hex.EncodeToString(buf)
	path := filepath.Join(s.dir, stored)

	dst, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	// Cap the copy one byte past the limit so an oversized upload is detected.
	written, copyErr := io.Copy(dst, io.LimitReader(src, s.maxBytes+1))
	closeErr := dst.Close()
	if copyErr != nil {
		os.Remove(path)
		return nil, copyErr
	}
	if closeErr != nil {
		os.Remove(path)
		return nil, closeErr
	}
	if written > s.maxBytes {
		os.Remove(path)
		return nil, ErrTooLarge
	}
	// The real size is only known now, so the allowance is checked again with
	// it and the file removed if it would not fit.
	if err := s.quotas.CheckStorage(ctx, userID, written); err != nil {
		os.Remove(path)
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
	if err := s.attachments.Create(ctx, a); err != nil {
		os.Remove(path)
		return nil, err
	}
	return a, nil
}

// Open returns the metadata and an open file handle for download.
func (s *AttachmentService) Open(ctx context.Context, userID, id int64) (*domain.Attachment, *os.File, error) {
	a, err := s.attachments.ByID(ctx, userID, id)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(filepath.Join(s.dir, a.StoredName))
	if errors.Is(err, fs.ErrNotExist) {
		// The row exists but the file behind it does not — orphaned or
		// placeholder metadata. Same response as an unknown attachment: there
		// is nothing here to serve either way.
		return nil, nil, repo.ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	return a, f, nil
}

// Delete removes an attachment and its file.
func (s *AttachmentService) Delete(ctx context.Context, userID, id int64) error {
	a, err := s.attachments.ByID(ctx, userID, id)
	if err != nil {
		return err
	}
	if err := s.attachments.Delete(ctx, userID, id); err != nil {
		return err
	}
	// The row is gone; a leftover file is harmless but we clean up anyway.
	os.Remove(filepath.Join(s.dir, a.StoredName))
	return nil
}

// DeleteForTodo removes every attachment belonging to a todo.
func (s *AttachmentService) DeleteForTodo(ctx context.Context, userID, todoID int64) error {
	removed, err := s.attachments.DeleteForTodo(ctx, userID, todoID)
	if err != nil {
		return err
	}
	for _, a := range removed {
		os.Remove(filepath.Join(s.dir, a.StoredName))
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
		os.Remove(filepath.Join(s.dir, a.StoredName))
	}
	return nil
}
