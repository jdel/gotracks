package service

import (
	"context"
	"errors"
	"time"

	"github.com/jdel/gotracks/internal/auth"
	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// Admin-specific errors.
var (
	ErrLastAdmin  = errors.New("cannot remove the last admin")
	ErrSelfDelete = errors.New("cannot delete your own account")
	ErrSelfDemote = errors.New("cannot remove your own admin status")
	ErrForbidden  = errors.New("forbidden")
)

// AdminService manages user accounts. All methods assume the caller is an admin;
// the HTTP layer enforces that.
//
// It holds the whole store because deleting an account has to reach every table
// that account owns.
type AdminService struct {
	store       *repo.Store
	attachments *AttachmentService
}

// NewAdminService builds an AdminService.
func NewAdminService(store *repo.Store, attachments *AttachmentService) *AdminService {
	return &AdminService{store: store, attachments: attachments}
}

// RevokeSessions drops every refresh token a user holds, signing them out
// everywhere. Used after an admin changes a credential on their behalf.
func (s *AdminService) RevokeSessions(ctx context.Context, userID int64) error {
	return s.store.RefreshTokens.DeleteForUser(ctx, userID)
}

// GetUser returns one account.
func (s *AdminService) GetUser(ctx context.Context, id int64) (*domain.User, error) {
	return s.store.Users.ByID(ctx, id)
}

// MaxUserPageSize bounds one page of the admin user list.
const MaxUserPageSize = 200

// UsersPage is one filtered page of accounts plus the total that matched.
type UsersPage struct {
	Users []*domain.User
	Total int
	Page  int
	Size  int
}

// ListUsers returns one filtered page of accounts, oldest first. Filtering and
// paging both run in the database so the whole table is never loaded.
func (s *AdminService) ListUsers(ctx context.Context, f repo.UserFilter, p Page) (*UsersPage, error) {
	page, size, offset := p.Resolve(MaxUserPageSize)
	total, err := s.store.Users.CountFiltered(ctx, f)
	if err != nil {
		return nil, err
	}
	users, err := s.store.Users.ListPage(ctx, f, offset, size)
	if err != nil {
		return nil, err
	}
	return &UsersPage{Users: users, Total: total, Page: page, Size: size}, nil
}

// CreateUser adds an account that cannot sign in until it accepts the emailed
// invitation. The random value is never returned or shown; hashing it merely
// satisfies the non-null password column while keeping the pending account
// unreachable through password authentication.
func (s *AdminService) CreateUser(ctx context.Context, email string, isAdmin bool) (*domain.User, error) {
	email = auth.NormaliseEmail(email)
	if err := auth.ValidateEmail(email); err != nil {
		return nil, err
	}
	if _, err := s.store.Users.ByEmail(ctx, email); err == nil {
		return nil, ErrEmailTaken
	} else if !errors.Is(err, repo.ErrNotFound) {
		return nil, err
	}
	placeholder, err := randomToken()
	if err != nil {
		return nil, err
	}
	hash, err := auth.HashPasswordContext(ctx, placeholder)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	u := &domain.User{
		Email:     email,
		Password:  hash,
		IsAdmin:   isAdmin,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.store.Users.Create(ctx, u); err != nil {
		return nil, err
	}
	return u, nil
}

// adminGuardKey serializes every admin-count-then-mutate section on one shared
// lock. The last-admin invariant is instance-wide — two *different* admins can
// be removed at once — so unlike a quota it cannot key on the target account.
// Account ids start at 1, so 0 never collides with a real per-account guard.
const adminGuardKey = 0

// UpdateUser changes an account's email, password or admin flag. callerID is the
// administrator making the change, so an admin cannot strip their own rights.
func (s *AdminService) UpdateUser(ctx context.Context, callerID, id int64, email, password *string, isAdmin *bool) (*domain.User, error) {
	u, err := s.store.Users.ByID(ctx, id)
	if err != nil {
		return nil, err
	}
	// Removing your own admin rights is refused like self-deletion: an admin
	// who can still act should not lock themselves out in one click.
	if isAdmin != nil && !*isAdmin && u.IsAdmin && callerID == id {
		return nil, ErrSelfDemote
	}
	if email != nil {
		// Normalise and validate exactly as Register/CreateUser do: login looks
		// the address up normalised, so storing a raw value here would lock the
		// account out rather than fix it.
		next := auth.NormaliseEmail(*email)
		if err := auth.ValidateEmail(next); err != nil {
			return nil, err
		}
		u.Email = next
	}
	passwordChanged := password != nil && *password != ""
	if passwordChanged {
		if err := auth.ValidatePassword(*password); err != nil {
			return nil, err
		}
		hash, err := auth.HashPasswordContext(ctx, *password)
		if err != nil {
			return nil, err
		}
		u.Password = hash
	}
	u.UpdatedAt = time.Now()
	// The last-admin count and the write that depends on it must not interleave
	// with another admin change, or two demotions each see two admins and remove
	// both. The shared guard serializes every admin mutation instance-wide.
	if err := s.store.Guard.WithUser(ctx, adminGuardKey, func(ctx context.Context) error {
		if isAdmin != nil && *isAdmin != u.IsAdmin {
			if !*isAdmin && u.IsAdmin {
				admins, err := s.store.Users.CountAdmins(ctx)
				if err != nil {
					return err
				}
				if admins <= 1 {
					return ErrLastAdmin
				}
			}
			u.IsAdmin = *isAdmin
		}
		return s.store.Users.Update(ctx, u)
	}); err != nil {
		return nil, err
	}
	// A password is usually reset because the account is compromised. Sessions
	// issued under the old password would otherwise keep minting access tokens
	// for the whole refresh lifetime, so the reset has to evict them.
	if passwordChanged {
		if err := s.store.RefreshTokens.DeleteForUser(ctx, u.ID); err != nil {
			return nil, err
		}
	}
	return u, nil
}

// DeleteUser removes an account and everything it owns. The caller cannot
// delete themselves, and the last remaining admin cannot be removed.
//
// The schema has no foreign keys, so nothing cascades on its own: every table
// holding the user's rows is cleared here, or the account's data would outlive
// the account it was private to.
func (s *AdminService) DeleteUser(ctx context.Context, callerID, id int64) error {
	if callerID == id {
		return ErrSelfDelete
	}
	u, err := s.store.Users.ByID(ctx, id)
	if err != nil {
		return err
	}
	// Same instance-wide invariant: the count and the purge it authorizes run
	// under the shared admin guard so a concurrent change cannot slip between.
	return s.store.Guard.WithUser(ctx, adminGuardKey, func(ctx context.Context) error {
		if u.IsAdmin {
			admins, err := s.store.Users.CountAdmins(ctx)
			if err != nil {
				return err
			}
			if admins <= 1 {
				return ErrLastAdmin
			}
		}
		return s.purgeAccount(ctx, id)
	})
}

// DeleteOwnAccount removes the requesting account and everything it owns.
// Mailbox confirmation is enforced by the HTTP flow before this is called. As
// with administrator-initiated deletion, the last administrator is preserved
// so the instance cannot be left without administration by accident.
func (s *AdminService) DeleteOwnAccount(ctx context.Context, id int64) error {
	return s.store.Guard.WithUser(ctx, adminGuardKey, func(ctx context.Context) error {
		if err := s.CanDeleteOwnAccount(ctx, id); err != nil {
			return err
		}
		return s.purgeAccount(ctx, id)
	})
}

// CanDeleteOwnAccount checks the administration invariant before a deletion
// email is sent. DeleteOwnAccount checks again at confirmation time because
// the set of administrators may change while the link is in flight.
func (s *AdminService) CanDeleteOwnAccount(ctx context.Context, id int64) error {
	u, err := s.store.Users.ByID(ctx, id)
	if err != nil {
		return err
	}
	if u.IsAdmin {
		admins, err := s.store.Users.CountAdmins(ctx)
		if err != nil {
			return err
		}
		if admins <= 1 {
			return ErrLastAdmin
		}
	}
	return nil
}

func (s *AdminService) purgeAccount(ctx context.Context, id int64) error {
	u, err := s.store.Users.ByID(ctx, id)
	if err != nil {
		return err
	}

	// Credentials first: whatever fails later, the account can no longer be
	// authenticated with.
	if err := s.store.RefreshTokens.DeleteForUser(ctx, id); err != nil {
		return err
	}
	if err := s.store.Credentials.DeleteForUser(ctx, id); err != nil {
		return err
	}
	if err := s.store.TwoFactor.DeleteForUser(ctx, id); err != nil {
		return err
	}
	if err := s.store.RecoveryCodes.DeleteForUser(ctx, id); err != nil {
		return err
	}
	if err := s.store.Ephemeral.DeleteForUser(ctx, id); err != nil {
		return err
	}
	if err := s.store.UsageReports.DeleteForUser(ctx, id); err != nil {
		return err
	}
	if err := s.store.LoginAttempts.Clear(ctx, u.Email); err != nil {
		return err
	}
	// Files on disk, before the rows that name them.
	if s.attachments != nil {
		if err := s.attachments.DeleteForUser(ctx, id); err != nil {
			return err
		}
	}
	for _, purge := range []func(context.Context, int64) error{
		s.store.Tags.DeleteForUser,
		s.store.Todos.DeleteForUser,
		s.store.Recurring.DeleteForUser,
		s.store.Notes.DeleteForUser,
		s.store.Projects.DeleteForUser,
		s.store.Contexts.DeleteForUser,
		s.store.Legal.DeleteForUser,
		s.store.Preferences.Delete,
	} {
		if err := purge(ctx, id); err != nil {
			return err
		}
	}
	return s.store.Users.Delete(ctx, id)
}
