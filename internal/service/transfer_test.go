package service_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"maps"
	"slices"
	"strings"
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

// Portability is the other half of erasure: an account that can delete
// everything it owns has to be able to take everything it owns, and a JSON file
// describing attachments it does not carry is not that.
func TestExportArchiveCarriesTheFilesThemselves(t *testing.T) {
	ctx := context.Background()
	todos, store, contextID := newTodoService(t)
	attachments := service.NewAttachmentService(store.Attachments, store.Todos, testStore(t), 1<<20)
	transfer := service.NewTransferService(store, todos)
	transfer.SetAttachments(attachments)

	description := "Paint the wall"
	todo, err := todos.Create(ctx, 1, service.TodoInput{
		ContextID: &contextID, Description: &description,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Two files sharing a name, which is exactly what a flat archive collides
	// on and what an account can trivially produce.
	for _, body := range []string{"first file", "second file"} {
		if _, err := attachments.Save(
			ctx, 1, todo.ID, "notes.pdf", "application/pdf", strings.NewReader(body),
		); err != nil {
			t.Fatal(err)
		}
	}

	var buf bytes.Buffer
	if err := transfer.WriteZip(ctx, &buf, 1); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("the export is not a readable archive: %v", err)
	}

	members := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		members[f.Name] = string(content)
	}

	if _, ok := members["export.json"]; !ok {
		t.Fatalf("no export.json in the archive: %v", slices.Sorted(maps.Keys(members)))
	}
	var export service.Export
	if err := json.Unmarshal([]byte(members["export.json"]), &export); err != nil {
		t.Fatal(err)
	}
	if len(export.Attachments) != 2 {
		t.Fatalf("the manifest lists %d attachments, want 2", len(export.Attachments))
	}

	// Every path the manifest promises is in the archive, holding the bytes
	// that were uploaded — a manifest that does not match the archive is worse
	// than no manifest.
	seen := map[string]bool{}
	for _, a := range export.Attachments {
		if a.Action != description {
			t.Errorf("attachment names the action %q, want %q", a.Action, description)
		}
		if a.Path == "" {
			t.Fatalf("attachment %q has no path in the archive", a.FileName)
		}
		if seen[a.Path] {
			t.Fatalf("two attachments share the archive path %q", a.Path)
		}
		seen[a.Path] = true
		content, ok := members[a.Path]
		if !ok {
			t.Fatalf("the manifest promises %q but the archive has no such member", a.Path)
		}
		if content != "first file" && content != "second file" {
			t.Errorf("member %q holds unexpected content %q", a.Path, content)
		}
	}
}

// An upload names its own file, so the archive must not let that name decide
// where the bytes land when somebody unpacks it.
func TestExportArchivePathsAreContained(t *testing.T) {
	ctx := context.Background()
	todos, store, contextID := newTodoService(t)
	attachments := service.NewAttachmentService(store.Attachments, store.Todos, testStore(t), 1<<20)
	transfer := service.NewTransferService(store, todos)
	transfer.SetAttachments(attachments)

	description := "Hold the file"
	todo, err := todos.Create(ctx, 1, service.TodoInput{
		ContextID: &contextID, Description: &description,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Written straight to the repository, so the archive is tested rather than
	// the upload validation that would normally have trimmed this.
	if err := store.Attachments.Create(ctx, &domain.Attachment{
		UserID: 1, TodoID: todo.ID, FileName: `../../etc/passwd`,
		ContentType: "text/plain", Size: 3, StoredName: "deadbeef", CreatedAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	if err := transfer.WriteZip(ctx, &buf, 1); err != nil {
		t.Fatal(err)
	}
	var export service.Export
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	for _, f := range zr.File {
		if strings.Contains(f.Name, "..") || strings.HasPrefix(f.Name, "/") {
			t.Fatalf("archive member escapes its folder: %q", f.Name)
		}
		if f.Name == "export.json" {
			rc, _ := f.Open()
			content, _ := io.ReadAll(rc)
			rc.Close()
			if err := json.Unmarshal(content, &export); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(export.Attachments) != 1 {
		t.Fatalf("the manifest lists %d attachments, want 1", len(export.Attachments))
	}
	// The row outlived its file, so it is described but carries nothing — one
	// orphan must not cost the account the rest of its export.
	if export.Attachments[0].Path != "" {
		if _, err := zr.Open(export.Attachments[0].Path); err != nil {
			t.Fatalf("promised member %q is absent: %v", export.Attachments[0].Path, err)
		}
	}
	if export.Attachments[0].FileName != `../../etc/passwd` {
		t.Errorf("the manifest lost the real filename: %q", export.Attachments[0].FileName)
	}
}
