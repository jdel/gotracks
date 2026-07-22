package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/service"
)

func TestExportUsesNamesInsteadOfDatabaseIDs(t *testing.T) {
	ctx := context.Background()
	todos, store, contextID := newTodoService(t)
	project := &domain.Project{UserID: 1, Name: "Renovate", State: domain.StateActive, Position: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := store.Projects.Create(ctx, project); err != nil {
		t.Fatal(err)
	}
	description := "Paint the wall"
	if _, err := todos.Create(ctx, 1, service.TodoInput{ContextID: &contextID, ProjectID: &project.ID, Description: &description}); err != nil {
		t.Fatal(err)
	}
	export, err := service.NewTransferService(store, todos).Gather(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(export)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"context":"@home"`)) || !bytes.Contains(raw, []byte(`"project":"Renovate"`)) {
		t.Fatalf("named references missing: %s", raw)
	}
	for _, field := range []string{"\"id\"", "contextId", "projectId", "userId", "position"} {
		if bytes.Contains(raw, []byte(field)) {
			t.Errorf("export leaked %q", field)
		}
	}
}
