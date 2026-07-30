package service_test

import (
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/jdel/gotracks/internal/service"
)

func TestLogLevelOverrideAutoReverts(t *testing.T) {
	prev := zerolog.GlobalLevel()
	t.Cleanup(func() { zerolog.SetGlobalLevel(prev) })
	zerolog.SetGlobalLevel(zerolog.InfoLevel)

	s := service.NewLogLevelService(zerolog.InfoLevel)
	s.Override(zerolog.DebugLevel, 40*time.Millisecond)

	if got := zerolog.GlobalLevel(); got != zerolog.DebugLevel {
		t.Fatalf("level after override = %s, want debug", got)
	}
	st := s.State()
	if st.Level != "debug" || st.Baseline != "info" || st.Until == nil {
		t.Fatalf("state = %+v", st)
	}

	time.Sleep(90 * time.Millisecond)
	if got := zerolog.GlobalLevel(); got != zerolog.InfoLevel {
		t.Fatalf("level did not auto-revert: %s", got)
	}
	if s.State().Until != nil {
		t.Error("override should be cleared after revert")
	}
}

func TestLogLevelRevertNow(t *testing.T) {
	prev := zerolog.GlobalLevel()
	t.Cleanup(func() { zerolog.SetGlobalLevel(prev) })
	zerolog.SetGlobalLevel(zerolog.WarnLevel)

	s := service.NewLogLevelService(zerolog.WarnLevel)
	s.Override(zerolog.DebugLevel, time.Hour)
	s.Revert()

	if got := zerolog.GlobalLevel(); got != zerolog.WarnLevel {
		t.Fatalf("Revert left level at %s, want warn", got)
	}
}
