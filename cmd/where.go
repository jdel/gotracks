package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

// whereCmd prints the paths gotracks resolved, which is the quickest way to
// answer "which config did it read?" and "where is my database?".
func whereCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "where",
		Short: "Show the resolved config file, database and storage locations",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			out := cmd.OutOrStdout()

			configFile := viper.ConfigFileUsed()
			if configFile == "" {
				configFile = "(none — using defaults, flags and GOTRACKS_* env vars)"
			}
			fmt.Fprintf(out, "config file:  %s\n", configFile)
			fmt.Fprintf(out, "database:     %s\n", viper.GetString("db.url"))
			fmt.Fprintf(out, "uploads:      %s\n", viper.GetString("storage.uploads"))

			if dirs, err := appScope.ConfigDirs(); err == nil && len(dirs) > 0 {
				fmt.Fprintf(out, "config dirs:  %s\n", strings.Join(dirs, "\n              "))
			}
			if dirs, err := appScope.DataDirs(); err == nil && len(dirs) > 0 {
				fmt.Fprintf(out, "data dirs:    %s\n", strings.Join(dirs, "\n              "))
			}
			return nil
		},
	}
}
