package service_test

import (
	"math"
	"testing"

	"github.com/jdel/gotracks/internal/service"
)

func TestPageResolve(t *testing.T) {
	const maxSize = 200
	cases := []struct {
		name                       string
		in                         service.Page
		page, size, offset         int
	}{
		{"normal", service.Page{Number: 3, Size: 10}, 3, 10, 20},
		{"zero falls back", service.Page{Number: 0, Size: 0}, 1, 50, 0},
		{"negatives clamp", service.Page{Number: -5, Size: -1}, 1, 50, 0},
		{"size over max clamps to max", service.Page{Number: 1, Size: 5000}, 1, 200, 0},
		{"huge page cannot overflow", service.Page{Number: math.MaxInt, Size: math.MaxInt}, math.MaxInt, 200, 1 << 30},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			page, size, offset := tc.in.Resolve(maxSize)
			if page != tc.page || size != tc.size || offset != tc.offset {
				t.Fatalf("Resolve = (%d,%d,%d), want (%d,%d,%d)",
					page, size, offset, tc.page, tc.size, tc.offset)
			}
			if offset < 0 {
				t.Fatalf("offset is negative: %d", offset)
			}
			if size < 1 || size > maxSize {
				t.Fatalf("size out of bounds: %d", size)
			}
		})
	}
}
