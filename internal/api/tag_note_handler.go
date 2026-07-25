package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jdel/gotracks/internal/domain"
	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// tagHandler serves the /tags endpoints.
type tagHandler struct {
	tags repo.TagRepo
}

// list returns the caller's tags.
//
//	@Summary	List tags
//	@Tags		tags
//	@Security	BearerAuth
//	@Success	200	{array}	domain.Tag
//	@Router		/api/v1/tags [get]
func (h *tagHandler) list(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	tags, err := h.tags.List(r.Context(), uid)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

// noteHandler serves the /notes endpoints.
type noteHandler struct {
	notes    repo.NoteRepo
	projects *service.ProjectService
	quotas   *service.QuotaService
}

// checkProject reports whether an explicit project id exists and belongs to the
// user, writing the error response itself. A nil id is accepted.
func (h *noteHandler) checkProject(w http.ResponseWriter, r *http.Request, uid int64, id *int64) bool {
	if id == nil {
		return true
	}
	if _, err := h.projects.Get(r.Context(), uid, *id); err != nil {
		writeError(w, http.StatusBadRequest, "unknown project")
		return false
	}
	return true
}

type noteRequest struct {
	Body      string `json:"body"`
	ProjectID *int64 `json:"projectId"`
	// ProjectName lets a client name a project instead of supplying an id —
	// an unknown name is created on the fly, the same "#project" behaviour a
	// todo or a recurring pattern gets. Ignored if ProjectID is also set.
	ProjectName *string `json:"projectName"`
	// ClearProject detaches an existing note from its project. A nil
	// ProjectID alone cannot mean that: it is also what "leave unchanged"
	// looks like on update.
	ClearProject bool `json:"clearProject"`
}

// resolveProject settles a request's project reference into an id, in order:
// an explicit id (validated), then a name (resolved or created), then nothing.
// Writes its own error response and returns ok=false on failure.
func (h *noteHandler) resolveProject(w http.ResponseWriter, r *http.Request, uid int64, req noteRequest) (id *int64, ok bool) {
	if req.ProjectID != nil {
		if !h.checkProject(w, r, uid, req.ProjectID) {
			return nil, false
		}
		return req.ProjectID, true
	}
	if req.ProjectName != nil && strings.TrimSpace(*req.ProjectName) != "" {
		resolved, err := h.projects.ResolveByName(r.Context(), uid, *req.ProjectName)
		if err != nil {
			writeServiceError(w, err)
			return nil, false
		}
		return &resolved, true
	}
	return nil, true
}

// list returns the caller's notes, optionally scoped to a project.
//
//	@Summary	List notes
//	@Tags		notes
//	@Security	BearerAuth
//	@Param		project	query	int	false	"Filter by project id"
//	@Success	200	{array}	domain.Note
//	@Router		/api/v1/notes [get]
func (h *noteHandler) list(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	var projectID *int64
	if v := r.URL.Query().Get("projectId"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid projectId")
			return
		}
		projectID = &id
	}
	notes, err := h.notes.List(r.Context(), uid, projectID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, notes)
}

// create adds a note.
//
//	@Summary	Create a note
//	@Tags		notes
//	@Security	BearerAuth
//	@Param		body	body		noteRequest	true	"Note"
//	@Success	201		{object}	domain.Note
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/notes [post]
func (h *noteHandler) create(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	var req noteRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Body == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if err := service.ValidateNoteBody(req.Body); err != nil {
		writeServiceError(w, err)
		return
	}
	// The note allowance, and the project a name may create, are both
	// check-then-insert, so the whole sequence runs under the account guard.
	var n *domain.Note
	failed := false
	err := h.quotas.Guard(r.Context(), uid, func(ctx context.Context) error {
		projectID, ok := h.resolveProject(w, r, uid, req)
		if !ok {
			// resolveProject has already written the response.
			failed = true
			return nil
		}
		if err := h.quotas.CheckNote(ctx, uid); err != nil {
			return err
		}
		now := time.Now()
		n = &domain.Note{
			UserID:    uid,
			ProjectID: projectID,
			Body:      req.Body,
			CreatedAt: now,
			UpdatedAt: now,
		}
		return h.notes.Create(ctx, n)
	})
	if failed {
		return
	}
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, n)
}

// update changes a note.
//
//	@Summary	Update a note
//	@Tags		notes
//	@Security	BearerAuth
//	@Param		id		path		int			true	"Note id"
//	@Param		body	body		noteRequest	true	"Note"
//	@Success	200		{object}	domain.Note
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/notes/{id} [put]
func (h *noteHandler) update(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req noteRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	n, err := h.notes.ByID(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if req.Body != "" {
		if err := service.ValidateNoteBody(req.Body); err != nil {
			writeServiceError(w, err)
			return
		}
		n.Body = req.Body
	}
	if req.ClearProject {
		n.ProjectID = nil
	} else if req.ProjectID != nil || req.ProjectName != nil {
		projectID, ok := h.resolveProject(w, r, uid, req)
		if !ok {
			return
		}
		n.ProjectID = projectID
	}
	n.UpdatedAt = time.Now()
	if err := h.notes.Update(r.Context(), n); err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, n)
}

// delete removes a note.
//
//	@Summary	Delete a note
//	@Tags		notes
//	@Security	BearerAuth
//	@Param		id	path	int	true	"Note id"
//	@Success	204		"deleted"
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/notes/{id} [delete]
func (h *noteHandler) delete(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.notes.Delete(r.Context(), uid, id); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
