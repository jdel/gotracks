package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jdel/gotracks/internal/service"
)

// contextHandler serves the /contexts endpoints.
type contextHandler struct {
	contexts *service.ContextService
}

type contextRequest struct {
	Name     string `json:"name"`
	State    string `json:"state"`
	Position *int   `json:"position"`
}

// list returns the caller's contexts.
//
//	@Summary	List contexts
//	@Tags		contexts
//	@Security	BearerAuth
//	@Success	200	{array}	domain.Context
//	@Router		/api/v1/contexts [get]
func (h *contextHandler) list(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	cs, err := h.contexts.List(r.Context(), uid)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, cs)
}

// create adds a context.
//
//	@Summary	Create a context
//	@Tags		contexts
//	@Security	BearerAuth
//	@Param		body	body		contextRequest	true	"Context"
//	@Success	201		{object}	domain.Context
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/contexts [post]
func (h *contextHandler) create(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	var req contextRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	c, err := h.contexts.Create(r.Context(), uid, req.Name, req.State)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// get returns one context.
//
//	@Summary	Get a context
//	@Tags		contexts
//	@Security	BearerAuth
//	@Param		id	path		int	true	"Context id"
//	@Success	200	{object}	domain.Context
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/contexts/{id} [get]
func (h *contextHandler) get(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	c, err := h.contexts.Get(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// update changes a context.
//
//	@Summary	Update a context
//	@Tags		contexts
//	@Security	BearerAuth
//	@Param		id		path		int				true	"Context id"
//	@Param		body	body		contextRequest	true	"Context"
//	@Success	200		{object}	domain.Context
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/contexts/{id} [put]
func (h *contextHandler) update(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req contextRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	c, err := h.contexts.Update(r.Context(), uid, id, req.Name, req.State, req.Position)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// delete removes a context; a non-empty one needs ?force=true.
//
//	@Summary	Delete a context
//	@Tags		contexts
//	@Security	BearerAuth
//	@Param		id		path	int		true	"Context id"
//	@Param		force	query	bool	false	"Delete even if it holds actions"
//	@Success	204		"deleted"
//	@Failure	409		{object}	contextInUseBody
//	@Router		/api/v1/contexts/{id} [delete]
func (h *contextHandler) delete(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// Deleting a non-empty context destroys its actions, so it is refused
	// unless the client says it has confirmed that with the user.
	force := r.URL.Query().Get("force") == "true"
	if err := h.contexts.Delete(r.Context(), uid, id, force); err != nil {
		var inUse *service.ContextInUseError
		if errors.As(err, &inUse) {
			// Answer with the counts, so the client can state exactly what a
			// forced delete would take with it.
			writeJSON(w, http.StatusConflict, contextInUseBody{
				Error:     "context still holds actions",
				Todos:     inUse.Todos,
				Recurring: inUse.Recurring,
			})
			return
		}
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// contextInUseBody extends the usual {"error": …} shape with the counts a
// confirmation prompt needs.
type contextInUseBody struct {
	Error     string `json:"error"`
	Todos     int    `json:"todos"`
	Recurring int    `json:"recurring"`
}

// pathID parses the {id} path value as an int64.
func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}
