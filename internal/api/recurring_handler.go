package api

import (
	"net/http"

	"github.com/jdel/gotracks/internal/service"
)

// recurringHandler serves the /recurring endpoints.
type recurringHandler struct {
	recurring *service.RecurringService
}

type recurringRequest struct {
	ContextID    *int64  `json:"contextId"`
	ProjectID    *int64  `json:"projectId"`
	ContextName  *string `json:"contextName"`
	ProjectName  *string `json:"projectName"`
	Description  *string `json:"description"`
	State        *string `json:"state"`
	Period       *string `json:"period"`
	EveryN       *int    `json:"everyN"`
	Weekdays     *string `json:"weekdays"`
	DayOfMonth   *int    `json:"dayOfMonth"`
	MonthOfYear  *int    `json:"monthOfYear"`
	ShowFromDays *int    `json:"showFromDays"`
	StartFrom    *string `json:"startFrom"`
	EndDate      *string `json:"endDate"`
	// ClearProject detaches the pattern from its project. A nil projectId
	// cannot say that: it is also what "leave unchanged" looks like.
	ClearProject bool `json:"clearProject"`
}

func (r *recurringRequest) toInput() (service.RecurringInput, bool) {
	in := service.RecurringInput{
		ContextID:    r.ContextID,
		ProjectID:    r.ProjectID,
		ContextName:  r.ContextName,
		ProjectName:  r.ProjectName,
		Description:  r.Description,
		State:        r.State,
		Period:       r.Period,
		EveryN:       r.EveryN,
		Weekdays:     r.Weekdays,
		DayOfMonth:   r.DayOfMonth,
		MonthOfYear:  r.MonthOfYear,
		ShowFromDays: r.ShowFromDays,
		ClearProject: r.ClearProject,
	}
	if r.StartFrom != nil && *r.StartFrom != "" {
		t, err := parseDate(*r.StartFrom)
		if err != nil {
			return in, false
		}
		in.StartFrom = &t
	}
	if r.EndDate != nil {
		if *r.EndDate == "" {
			in.ClearEndDate = true
		} else {
			t, err := parseDate(*r.EndDate)
			if err != nil {
				return in, false
			}
			in.EndDate = &t
		}
	}
	return in, true
}

// list returns the caller's recurring actions.
//
//	@Summary	List recurring actions
//	@Tags		recurring
//	@Security	BearerAuth
//	@Success	200	{array}	domain.RecurringTodo
//	@Router		/api/v1/recurring [get]
func (h *recurringHandler) list(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	recs, err := h.recurring.List(r.Context(), uid, r.URL.Query().Get("state"))
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, recs)
}

// create adds a recurring action.
//
//	@Summary	Create a recurring action
//	@Tags		recurring
//	@Security	BearerAuth
//	@Param		body	body		recurringRequest	true	"Recurring action"
//	@Success	201		{object}	domain.RecurringTodo
//	@Failure	400		{object}	errorBody
//	@Router		/api/v1/recurring [post]
func (h *recurringHandler) create(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	var req recurringRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	in, ok := req.toInput()
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid date format")
		return
	}
	rec, err := h.recurring.Create(r.Context(), uid, in)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}

// get returns one recurring action.
//
//	@Summary	Get a recurring action
//	@Tags		recurring
//	@Security	BearerAuth
//	@Param		id	path		int	true	"Recurring action id"
//	@Success	200	{object}	domain.RecurringTodo
//	@Failure	404	{object}	errorBody
//	@Router		/api/v1/recurring/{id} [get]
func (h *recurringHandler) get(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	rec, err := h.recurring.Get(r.Context(), uid, id)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// update changes a recurring action.
//
//	@Summary	Update a recurring action
//	@Tags		recurring
//	@Security	BearerAuth
//	@Param		id		path		int					true	"Recurring action id"
//	@Param		body	body		recurringRequest	true	"Recurring action"
//	@Success	200		{object}	domain.RecurringTodo
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/recurring/{id} [put]
func (h *recurringHandler) update(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req recurringRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	in, ok := req.toInput()
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid date format")
		return
	}
	rec, err := h.recurring.Update(r.Context(), uid, id, in)
	if err != nil {
		writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// delete removes a recurring action.
//
//	@Summary	Delete a recurring action
//	@Tags		recurring
//	@Security	BearerAuth
//	@Param		id	path	int	true	"Recurring action id"
//	@Success	204		"deleted"
//	@Failure	404		{object}	errorBody
//	@Router		/api/v1/recurring/{id} [delete]
func (h *recurringHandler) delete(w http.ResponseWriter, r *http.Request) {
	uid := claimsFrom(r).UserID
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.recurring.Delete(r.Context(), uid, id); err != nil {
		writeServiceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
