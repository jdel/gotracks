package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jdel/gotracks/internal/repo"
	"github.com/jdel/gotracks/internal/service"
)

// todoHandler serves the /todos endpoints.
type todoHandler struct {
	todos *service.TodoService
}

// todoRequest is the JSON body for create/update. Pointers distinguish
// "absent" from "explicitly set", so PATCH-style partial updates work.
type todoRequest struct {
	ContextID *int64 `json:"contextId"`
	ProjectID *int64 `json:"projectId"`
	// Names are an alternative to ids: an unknown name is created automatically.
	ContextName *string   `json:"contextName"`
	ProjectName *string   `json:"projectName"`
	Description *string   `json:"description"`
	Due         *string   `json:"due"`
	ShowFrom    *string   `json:"showFrom"`
	Starred     *bool     `json:"starred"`
	Tags        *[]string `json:"tags"`
}

// toInput converts the request into a service input, parsing dates.
// An explicit JSON null on due/showFrom/projectId clears the field.
func (r *todoRequest) toInput() (service.TodoInput, bool) {
	in := service.TodoInput{
		ContextID:   r.ContextID,
		ProjectID:   r.ProjectID,
		ContextName: r.ContextName,
		ProjectName: r.ProjectName,
		Description: r.Description,
		Starred:     r.Starred,
	}
	if r.Due != nil {
		if *r.Due == "" {
			in.ClearDue = true
		} else {
			t, err := parseDate(*r.Due)
			if err != nil {
				return in, false
			}
			in.Due = &t
		}
	}
	if r.ShowFrom != nil {
		if *r.ShowFrom == "" {
			in.ClearShowFrom = true
		} else {
			t, err := parseDate(*r.ShowFrom)
			if err != nil {
				return in, false
			}
			in.ShowFrom = &t
		}
	}
	if r.Tags != nil {
		in.Tags = *r.Tags
		in.HasTags = true
	}
	return in, true
}

// parseDate accepts RFC3339 or a plain YYYY-MM-DD date.
func parseDate(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Parse("2006-01-02", s)
}

// list returns the caller's actions, filtered by query parameters.
//
//	@Summary	List actions
//	@Tags		todos
//	@Security	BearerAuth
//	@Param		context		query	int		false	"Filter by context id"
//	@Param		project		query	int		false	"Filter by project id"
//	@Param		state		query	string	false	"Filter by state"
//	@Success	200	{array}	domain.Todo
//	@Router		/api/v1/todos [get]
func (h *todoHandler) list(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	q := r.URL.Query()

	f := repo.TodoFilter{
		State:   q.Get("state"),
		Tag:     q.Get("tag"),
		Starred: q.Get("starred") == "true",
	}
	if v := q.Get("contextId"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid contextId")
			return
		}
		f.ContextID = &id
	}
	if v := q.Get("projectId"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid projectId")
			return
		}
		f.ProjectID = &id
	}
	if q.Get("dueBefore") != "" {
		t, err := parseDate(q.Get("dueBefore"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid dueBefore")
			return
		}
		f.DueBefore = &t
	}

	todos, err := h.todos.List(r.Context(), uid, f)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, todos)
}

// create adds an action.
//
//	@Summary	Create an action
//	@Tags		todos
//	@Security	BearerAuth
//	@Param		body	body		todoRequest	true	"Action"
//	@Success	201		{object}	domain.Todo
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/todos [post]
func (h *todoHandler) create(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	var req todoRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	in, ok := req.toInput()
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid date format")
		return
	}
	t, err := h.todos.Create(r.Context(), uid, in)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// get returns one action.
//
//	@Summary	Get an action
//	@Tags		todos
//	@Security	BearerAuth
//	@Param		id	path		int	true	"Action id"
//	@Success	200	{object}	domain.Todo
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/todos/{id} [get]
func (h *todoHandler) get(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	t, err := h.todos.Get(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// update changes an action.
//
//	@Summary	Update an action
//	@Tags		todos
//	@Security	BearerAuth
//	@Param		id		path		int			true	"Action id"
//	@Param		body	body		todoRequest	true	"Action"
//	@Success	200		{object}	domain.Todo
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/todos/{id} [put]
func (h *todoHandler) update(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req todoRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	in, ok := req.toInput()
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid date format")
		return
	}
	t, err := h.todos.Update(r.Context(), uid, id, in)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// complete marks an action done.
//
//	@Summary	Complete an action
//	@Tags		todos
//	@Security	BearerAuth
//	@Param		id	path		int	true	"Action id"
//	@Success	200	{object}	domain.Todo
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/todos/{id}/complete [post]
func (h *todoHandler) complete(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	t, err := h.todos.Complete(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// reactivate returns a completed action to active.
//
//	@Summary	Reactivate an action
//	@Tags		todos
//	@Security	BearerAuth
//	@Param		id	path		int	true	"Action id"
//	@Success	200	{object}	domain.Todo
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/todos/{id}/reactivate [post]
func (h *todoHandler) reactivate(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	t, err := h.todos.Reactivate(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type reorderRequest struct {
	Position int `json:"position"`
}

// reorder moves an action to a new position.
//
//	@Summary	Reorder an action
//	@Tags		todos
//	@Security	BearerAuth
//	@Param		id		path	int				true	"Action id"
//	@Param		body	body	reorderRequest	true	"Target position"
//	@Success	204		"reordered"
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/todos/{id}/reorder [post]
func (h *todoHandler) reorder(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req reorderRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	t, err := h.todos.Reorder(r.Context(), uid, id, req.Position)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// delete removes an action and its attachments.
//
//	@Summary	Delete an action
//	@Tags		todos
//	@Security	BearerAuth
//	@Param		id	path	int	true	"Action id"
//	@Success	204		"deleted"
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/todos/{id} [delete]
func (h *todoHandler) delete(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.todos.Delete(r.Context(), uid, id); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
