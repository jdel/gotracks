// Command gotracks is a GTD web application: a Go API and an embedded SPA.
package main

import (
	"fmt"
	"os"

	// Embed the IANA time zone database in the binary. Without this a
	// CGO-free build on a minimal image (alpine has no tzdata) cannot
	// time.LoadLocation any zone but UTC, so setting a timezone preference
	// would be rejected server-side.
	_ "time/tzdata"

	"github.com/jdel/gotracks/cmd"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	cmd.SetVersion(version)
	if err := cmd.RootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
