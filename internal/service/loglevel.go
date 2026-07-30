package service

import (
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// LogLevelService lets an administrator raise the global log level at runtime to
// troubleshoot, without a restart, and reverts it automatically after a window
// so a forgotten debug session cannot fill the disk.
//
// zerolog's global level is an atomic value read on every log call, so a change
// takes effect immediately for every logger, in-process and across none of the
// state that would need a restart.
type LogLevelService struct {
	mu       sync.Mutex
	baseline zerolog.Level
	timer    *time.Timer
	until    time.Time // zero when no override is active
}

// NewLogLevelService records the configured baseline the level reverts to.
func NewLogLevelService(baseline zerolog.Level) *LogLevelService {
	return &LogLevelService{baseline: baseline}
}

// Override sets the global level. A positive duration schedules an automatic
// revert to the baseline; a zero duration (or setting the baseline itself)
// leaves it in place with no timer. Any earlier revert timer is cancelled.
func (s *LogLevelService) Override(level zerolog.Level, d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	zerolog.SetGlobalLevel(level)
	if d > 0 && level != s.baseline {
		s.until = time.Now().Add(d)
		s.timer = time.AfterFunc(d, s.revert)
	} else {
		s.until = time.Time{}
	}
}

// Revert restores the configured baseline immediately.
func (s *LogLevelService) Revert() { s.Override(s.baseline, 0) }

func (s *LogLevelService) revert() {
	s.mu.Lock()
	defer s.mu.Unlock()
	zerolog.SetGlobalLevel(s.baseline)
	s.until = time.Time{}
	s.timer = nil
}

// LogLevelState is the current level, the baseline it reverts to, and when an
// active override expires (nil when none is active).
type LogLevelState struct {
	Level    string     `json:"level"`
	Baseline string     `json:"baseline"`
	Until    *time.Time `json:"overrideUntil"`
}

// State reports the current level, the baseline, and when an override reverts.
func (s *LogLevelService) State() LogLevelState {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := LogLevelState{
		Level:    zerolog.GlobalLevel().String(),
		Baseline: s.baseline.String(),
	}
	if !s.until.IsZero() {
		until := s.until
		st.Until = &until
	}
	return st
}
