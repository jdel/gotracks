//	@title		gotracks API
//	@version	1.0
//	@description	A GTD web application: actions, contexts, projects and the tickler.
//	@BasePath	/
//	@securityDefinitions.apikey	BearerAuth
//	@in							header
//	@name						Authorization
//	@description				Type "Bearer" followed by a space and the access token.
package cmd

//go:generate go tool swag init --dir .,../internal/api --generalInfo doc.go --parseDependency --parseInternal --output ../internal/docs
