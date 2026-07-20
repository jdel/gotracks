// Command gotracks is a GTD web application: a Go API and an embedded SPA.
package main

import (
	"fmt"
	"os"

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
