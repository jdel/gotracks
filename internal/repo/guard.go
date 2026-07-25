package repo

import (
	"context"
	"sync"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

// quotaLockClass keeps the per-account advisory locks in their own key space so
// they cannot collide with the enrollment lock.
const quotaLockClass = 0x71756f74

// UserGuard serializes one account's quota-bounded work.
//
// Every count and byte quota is check-then-insert: without serialization two
// concurrent requests can both observe usage below the limit and both insert,
// so a bounded account grows past its bound by the number of requests in
// flight. Running the check and the insert inside WithUser makes the pair
// atomic with respect to every other request for the same account.
//
// The guard is per account, never global: two accounts never wait on each
// other.
type UserGuard interface {
	WithUser(ctx context.Context, userID int64, fn func(context.Context) error) error
}

type userGuard struct {
	db *bun.DB

	mu    sync.Mutex
	locks map[int64]*guardEntry
}

// guardEntry is one account's lock. The buffered channel is the lock itself
// rather than a sync.Mutex because waiting for it has to observe request
// cancellation: a client that has gone away should not keep a worker parked
// behind a queue of writes for the same account.
type guardEntry struct {
	ch   chan struct{}
	refs int
}

func newUserGuard(db *bun.DB) *userGuard {
	return &userGuard{db: db, locks: make(map[int64]*guardEntry)}
}

func (g *userGuard) WithUser(ctx context.Context, userID int64, fn func(context.Context) error) error {
	release, err := g.lockLocal(ctx, userID)
	if err != nil {
		return err
	}
	defer release()

	if g.db.Dialect().Name() != dialect.PG {
		// SQLite is one file with one writer, so a deployment on it is a single
		// process and the in-process lock is the whole story.
		return fn(ctx)
	}
	// Postgres can back several instances, so the exclusion has to live in the
	// database. The lock is released when this transaction ends. fn reads and
	// writes on other pooled connections, which is precisely what makes its
	// work committed and visible to the next holder of the lock.
	return g.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		// The two-argument form takes int4 keys. Truncating a larger user id
		// can only make two accounts share one lock, which over-serializes
		// rather than under-protects.
		if _, err := tx.ExecContext(ctx,
			"SELECT pg_advisory_xact_lock(?, ?)", quotaLockClass, int32(userID),
		); err != nil {
			return err
		}
		return fn(ctx)
	})
}

// lockLocal takes the account's in-process lock and returns its release. The
// entry is reference-counted so the map holds only accounts with live waiters.
func (g *userGuard) lockLocal(ctx context.Context, userID int64) (func(), error) {
	g.mu.Lock()
	entry := g.locks[userID]
	if entry == nil {
		entry = &guardEntry{ch: make(chan struct{}, 1)}
		g.locks[userID] = entry
	}
	entry.refs++
	g.mu.Unlock()

	drop := func() {
		g.mu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(g.locks, userID)
		}
		g.mu.Unlock()
	}

	select {
	case entry.ch <- struct{}{}:
		return func() {
			<-entry.ch
			drop()
		}, nil
	case <-ctx.Done():
		drop()
		return nil, ctx.Err()
	}
}
