package storage

import (
	"os"
	"path/filepath"
	"testing"
)

// TestCredentialChainReadsProfileFile proves the shared credentials file and
// AWS_PROFILE are in the chain: with no credentials in the environment, the
// keys resolve from the named profile.
func TestCredentialChainReadsProfileFile(t *testing.T) {
	// Clear env-based credentials so the chain falls through to the file.
	for _, k := range []string{"AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "AWS_SECRET_KEY", "MINIO_ROOT_USER", "MINIO_ACCESS_KEY"} {
		t.Setenv(k, "")
	}

	file := filepath.Join(t.TempDir(), "credentials")
	body := "[work]\naws_access_key_id = AKIAWORK\naws_secret_access_key = worksecret\n"
	if err := os.WriteFile(file, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", file)
	t.Setenv("AWS_PROFILE", "work")

	v, err := awsCredentials().Get()
	if err != nil {
		t.Fatalf("resolve credentials: %v", err)
	}
	if v.AccessKeyID != "AKIAWORK" || v.SecretAccessKey != "worksecret" {
		t.Fatalf("got %q/%q, want AKIAWORK/worksecret from the work profile", v.AccessKeyID, v.SecretAccessKey)
	}
}

// TestCredentialChainPrefersEnv proves env credentials win over the file, the
// same precedence the AWS SDKs use.
func TestCredentialChainPrefersEnv(t *testing.T) {
	file := filepath.Join(t.TempDir(), "credentials")
	if err := os.WriteFile(file, []byte("[default]\naws_access_key_id = FROMFILE\naws_secret_access_key = filesecret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", file)
	t.Setenv("AWS_ACCESS_KEY_ID", "FROMENV")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "envsecret")

	v, err := awsCredentials().Get()
	if err != nil {
		t.Fatalf("resolve credentials: %v", err)
	}
	if v.AccessKeyID != "FROMENV" {
		t.Fatalf("got %q, want env to win", v.AccessKeyID)
	}
}
