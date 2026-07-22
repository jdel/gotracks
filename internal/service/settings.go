package service

import (
	"context"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
)

// SettingsService exposes server-wide settings an admin can change at runtime.
type SettingsService struct {
	settings repo.SettingsRepo
	// defaultAllowRegister seeds the row on first use, from configuration.
	defaultAllowRegister bool
}

// NewSettingsService builds a SettingsService.
func NewSettingsService(s repo.SettingsRepo, defaultAllowRegister bool) *SettingsService {
	return &SettingsService{settings: s, defaultAllowRegister: defaultAllowRegister}
}

// Get returns the current settings.
func (s *SettingsService) Get(ctx context.Context) (*domain.InstanceSettings, error) {
	settings, err := s.settings.Get(ctx, s.defaultAllowRegister)
	if err != nil {
		return nil, err
	}
	if settings.UsageReportTimeZone == "" {
		settings.UsageReportTimeZone = "UTC"
	}
	return settings, nil
}

// Raw returns the whole settings row.
func (s *SettingsService) Raw(ctx context.Context) (*domain.InstanceSettings, error) {
	return s.Get(ctx)
}

// SetUsageReportAtMinute changes the local wall-clock time at which the usage
// report is rebuilt (minutes since midnight, wrapped into 0-1439). The time
// zone is configured separately and defaults to UTC.
func (s *SettingsService) SetUsageReportAtMinute(ctx context.Context, minute int) (*domain.InstanceSettings, error) {
	cur, err := s.Get(ctx)
	if err != nil {
		return nil, err
	}
	minute %= 1440
	if minute < 0 {
		minute += 1440
	}
	cur.UsageReportAtMinute = minute
	if err := s.settings.Update(ctx, cur); err != nil {
		return nil, err
	}
	return cur, nil
}

// SetUsageReportTimeZone changes the IANA time zone used by the report schedule.
func (s *SettingsService) SetUsageReportTimeZone(ctx context.Context, zone string) (*domain.InstanceSettings, error) {
	if _, err := time.LoadLocation(zone); err != nil {
		return nil, ErrValidation
	}
	cur, err := s.Get(ctx)
	if err != nil {
		return nil, err
	}
	cur.UsageReportTimeZone = zone
	if err := s.settings.Update(ctx, cur); err != nil {
		return nil, err
	}
	return cur, nil
}

// SetUsageReportRunAt records when the report was last rebuilt.
func (s *SettingsService) SetUsageReportRunAt(ctx context.Context, at time.Time) error {
	cur, err := s.Get(ctx)
	if err != nil {
		return err
	}
	cur.UsageReportRunAt = &at
	return s.settings.Update(ctx, cur)
}

// AllowRegister reports whether self-registration is currently open.
func (s *SettingsService) AllowRegister(ctx context.Context) (bool, error) {
	cur, err := s.Get(ctx)
	if err != nil {
		return false, err
	}
	return cur.AllowRegister, nil
}

// SetAllowRegister turns self-registration on or off.
func (s *SettingsService) SetAllowRegister(ctx context.Context, allow bool) (*domain.InstanceSettings, error) {
	cur, err := s.Get(ctx)
	if err != nil {
		return nil, err
	}
	cur.AllowRegister = allow
	if err := s.settings.Update(ctx, cur); err != nil {
		return nil, err
	}
	return cur, nil
}
