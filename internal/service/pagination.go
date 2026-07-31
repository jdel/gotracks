package service

// Offset pagination, in one place. Every paginated endpoint parses its request
// into a Page and calls Resolve, so the clamping and the overflow guard live
// here rather than being re-derived (and re-fixed) per endpoint.

// defaultPageSize is used when a request asks for a non-positive page size.
const defaultPageSize = 50

// maxOffset caps the computed offset so a huge page number cannot overflow
// (page-1)*size into a negative index. A page this far past the data is empty
// regardless, so capping loses nothing real.
const maxOffset = 1 << 30

// Page is an offset-pagination request as received from the client: a 1-based
// page number and a page size, either of which may be junk.
type Page struct {
	Number int
	Size   int
}

// Resolve clamps the request and returns the effective 1-based page, the page
// size (bounded to [1, maxSize]) and the offset to skip. The offset is computed
// without overflowing, so an out-of-range page yields an empty page rather than
// a negative index. Callers holding the whole result set in memory must still
// bound the slice end by the total.
func (p Page) Resolve(maxSize int) (page, size, offset int) {
	size = p.Size
	switch {
	case size < 1:
		size = defaultPageSize
	case size > maxSize:
		size = maxSize
	}
	page = p.Number
	if page < 1 {
		page = 1
	}
	// Only multiply when the result stays within maxOffset, so (page-1)*size
	// can never wrap negative.
	if page-1 > maxOffset/size {
		offset = maxOffset
	} else {
		offset = (page - 1) * size
	}
	return page, size, offset
}
