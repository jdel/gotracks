package api

import (
	"errors"
	"net/http"

	"github.com/jdel/gotracks/internal/service"
)

// projectHandler serves the /projects endpoints.
type projectHandler struct {
	projects *service.ProjectService
}

type projectRequest struct {
	Name             *string `json:"name"`
	Description      *string `json:"description"`
	State            *string `json:"state"`
	Position         *int    `json:"position"`
	DefaultContextID *int64  `json:"defaultContextId"`
}

func (r *projectRequest) toInput() service.ProjectInput {
	return service.ProjectInput{
		Name:             r.Name,
		Description:      r.Description,
		State:            r.State,
		Position:         r.Position,
		DefaultContextID: r.DefaultContextID,
	}
}

// list returns the caller's projects.
//
//	@Summary	List projects
//	@Tags		projects
//	@Security	BearerAuth
//	@Success	200	{array}	domain.Project
//	@Router		/api/v1/projects [get]
func (h *projectHandler) list(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	ps, err := h.projects.List(r.Context(), uid, r.URL.Query().Get("state"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ps)
}

// create adds a project.
//
//	@Summary	Create a project
//	@Tags		projects
//	@Security	BearerAuth
//	@Param		body	body		projectRequest	true	"Project"
//	@Success	201		{object}	domain.Project
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/projects [post]
func (h *projectHandler) create(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	var req projectRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.projects.Create(r.Context(), uid, req.toInput())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// get returns one project.
//
//	@Summary	Get a project
//	@Tags		projects
//	@Security	BearerAuth
//	@Param		id	path		int	true	"Project id"
//	@Success	200	{object}	domain.Project
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/projects/{id} [get]
func (h *projectHandler) get(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	p, err := h.projects.Get(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// update changes a project.
//
//	@Summary	Update a project
//	@Tags		projects
//	@Security	BearerAuth
//	@Param		id		path		int				true	"Project id"
//	@Param		body	body		projectRequest	true	"Project"
//	@Success	200		{object}	domain.Project
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/projects/{id} [put]
func (h *projectHandler) update(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req projectRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.projects.Update(r.Context(), uid, id, req.toInput())
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// review marks a project as reviewed now.
//
//	@Summary	Mark a project reviewed
//	@Tags		projects
//	@Security	BearerAuth
//	@Param		id	path		int	true	"Project id"
//	@Success	200	{object}	domain.Project
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/projects/{id}/review [post]
func (h *projectHandler) review(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	p, err := h.projects.Review(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// delete removes a project; its actions are detached, not deleted.
//
//	@Summary	Delete a project
//	@Tags		projects
//	@Security	BearerAuth
//	@Param		id	path	int	true	"Project id"
//	@Success	204		"deleted"
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/projects/{id} [delete]
func (h *projectHandler) delete(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// Absent means "not decided yet": a project with notes then refuses so the
	// client can ask. Present, true/false says whether to delete or detach them.
	var deleteNotes *bool
	if v := r.URL.Query().Get("deleteNotes"); v != "" {
		b := v == "true"
		deleteNotes = &b
	}
	if err := h.projects.Delete(r.Context(), uid, id, deleteNotes); err != nil {
		var inUse *service.ProjectNotesInUseError
		if errors.As(err, &inUse) {
			// Answer with the count, so the client can state exactly what a
			// "delete them too" choice would take with it.
			writeJSON(w, http.StatusConflict, projectNotesInUseBody{
				Error: "project has notes",
				Notes: inUse.Notes,
			})
			return
		}
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// projectNotesInUseBody extends the usual {"error": …} shape with the count a
// confirmation prompt needs.
type projectNotesInUseBody struct {
	Error string `json:"error"`
	Notes int    `json:"notes"`
}
