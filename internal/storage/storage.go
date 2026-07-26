// Package storage puts attachment bytes behind a small object-store interface.
//
// There is exactly one implementation: an S3 client (minio-go). Real S3, R2,
// B2 and MinIO are reached by pointing it at an endpoint with credentials.
// "Local" is the same client talking to an in-process S3 server (gofakes3)
// backed by a directory on disk — so the storage code has a single code path
// that only ever speaks S3, and switching to shared object storage for a
// high-availability deployment is a change of configuration, not of code.
//
// Local mode is not highly available: the fake server lives inside this
// process and its files sit on this node's disk. It exists so a single-binary
// self-host keeps working with no external dependency, with the same
// durability as writing the files directly.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"

	"github.com/johannesboyne/gofakes3"
	"github.com/johannesboyne/gofakes3/backend/s3afero"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/spf13/afero"
)

// ErrNotFound reports that no object is stored under a key. Callers map it to
// their own not-found so an orphaned metadata row reads as an absent file.
var ErrNotFound = errors.New("object not found")

// Store is the whole surface the attachment service needs: put bytes under an
// opaque key, open them for reading (seekable, so range requests work), and
// remove them.
type Store interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error)
	Remove(ctx context.Context, key string) error
}

// Config selects the backing store. In s3 mode the endpoint and credentials
// are read from the standard AWS environment (with MinIO's variables as a
// fallback), not from here, so the same variables the official SDKs and the
// aws/mc CLIs already use configure this too — see newS3.
type Config struct {
	Type   string // "local" (default) or "s3"
	Dir    string // local: directory the fake server writes under
	Bucket string // bucket objects live in
}

const defaultBucket = "attachments"

// New builds the store described by cfg.
func New(cfg Config) (Store, error) {
	bucket := cfg.Bucket
	if bucket == "" {
		bucket = defaultBucket
	}
	switch cfg.Type {
	case "", "local":
		return newLocal(cfg.Dir, bucket)
	case "s3":
		return newS3(bucket)
	default:
		return nil, fmt.Errorf("unknown storage type %q (want local or s3)", cfg.Type)
	}
}

// newLocal wires the S3 client to an in-process gofakes3 server that persists
// to dir. No network socket is opened: requests are dispatched straight into
// the server's handler, so there is no port to expose or secure.
func newLocal(dir, bucket string) (Store, error) {
	if dir == "" {
		return nil, errors.New("storage: local mode needs a directory")
	}
	blobDir := filepath.Join(dir, "blob")
	metaDir := filepath.Join(dir, "meta")
	for _, d := range []string{blobDir, metaDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, fmt.Errorf("storage: %w", err)
		}
	}
	blobs := afero.NewBasePathFs(afero.NewOsFs(), blobDir)
	meta := afero.NewBasePathFs(afero.NewOsFs(), metaDir)
	backend, err := s3afero.SingleBucket(bucket, blobs, meta)
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}
	faker := gofakes3.New(backend)
	client, err := minio.New("gotracks.local", &minio.Options{
		Creds:     credentials.NewStaticV4("gotracks", "gotracks", ""),
		Secure:    false,
		Transport: inProcess{faker.Server()},
	})
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}
	// SingleBucket already exposes exactly this bucket, so nothing to create.
	return &s3Store{client: client, bucket: bucket}, nil
}

// newS3 points the client at a real S3-compatible endpoint and checks the
// bucket is reachable, so bad credentials or a missing bucket fail at startup
// rather than on the first upload.
//
// Endpoint and credentials come from the environment the official tooling
// already uses, not from our own flags.
//
// Credentials are resolved through the same precedence as the AWS default
// chain, first match wins:
//
//  1. Environment: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (and
//     AWS_SESSION_TOKEN), or MINIO_ROOT_USER / MINIO_ROOT_PASSWORD.
//  2. Shared credentials file: ~/.aws/credentials (or
//     AWS_SHARED_CREDENTIALS_FILE), profile AWS_PROFILE or "default",
//     including a credential_process entry.
//  3. Instance role: EC2/ECS/EKS metadata and IRSA web identity.
//
// Not supported by the underlying S3 client: native SSO token caches
// (~/.aws/sso) and the region/SSO settings in ~/.aws/config — configure SSO
// through a credential_process in the credentials file if you need it.
//
// Endpoint and region are not credentials, so the S3 client does not read
// them; we do:
//   - Endpoint: AWS_ENDPOINT_URL_S3 or AWS_ENDPOINT_URL — a full URL whose
//     scheme decides HTTP vs HTTPS. Unset means real AWS S3.
//   - Region: AWS_REGION or AWS_DEFAULT_REGION.
func newS3(bucket string) (Store, error) {
	creds := awsCredentials()
	region := firstEnv("AWS_REGION", "AWS_DEFAULT_REGION")

	endpoint := firstEnv("AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL")
	secure := true
	if endpoint == "" {
		// No custom endpoint: address AWS S3 itself, regional when known.
		endpoint = "s3.amazonaws.com"
		if region != "" {
			endpoint = "s3." + region + ".amazonaws.com"
		}
	} else {
		u, err := url.Parse(endpoint)
		if err != nil || u.Host == "" {
			return nil, fmt.Errorf("storage: AWS_ENDPOINT_URL_S3 %q is not a valid URL", endpoint)
		}
		secure = u.Scheme != "http"
		endpoint = u.Host
	}

	client, err := minio.New(endpoint, &minio.Options{Creds: creds, Secure: secure, Region: region})
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}
	ctx := context.Background()
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("storage: reaching bucket %q at %s: %w", bucket, endpoint, err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: region}); err != nil {
			return nil, fmt.Errorf("storage: creating bucket %q: %w", bucket, err)
		}
	}
	return &s3Store{client: client, bucket: bucket}, nil
}

// awsCredentials builds the credential chain, first match wins, matching the
// AWS default-chain precedence. See newS3 for what each source reads.
func awsCredentials() *credentials.Credentials {
	return credentials.NewChainCredentials([]credentials.Provider{
		&credentials.EnvAWS{},
		&credentials.EnvMinio{},
		&credentials.FileAWSCredentials{},
		&credentials.IAM{},
	})
}

// firstEnv returns the value of the first named environment variable that is
// set and non-empty.
func firstEnv(names ...string) string {
	for _, n := range names {
		if v := os.Getenv(n); v != "" {
			return v
		}
	}
	return ""
}

// s3Store is the single Store implementation.
type s3Store struct {
	client *minio.Client
	bucket string
}

func (s *s3Store) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	// A known size plus an unsigned payload means one PUT carrying a real
	// Content-Length. The alternative — a streaming-signed payload — is chunked
	// with no Content-Length, which the local fake rejects; the object's
	// integrity rests on TLS to a real endpoint and on the in-process call
	// locally, so dropping the payload signature costs nothing here.
	_, err := s.client.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{
		ContentType:          contentType,
		DisableContentSha256: true,
		DisableMultipart:     true,
	})
	return err
}

func (s *s3Store) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	// GetObject is lazy; force the not-found now with a stat so an orphaned
	// row is reported as ErrNotFound rather than failing mid-download.
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return obj, nil
}

func (s *s3Store) Remove(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

// inProcess dispatches an HTTP request straight into a handler, so the S3
// client in local mode talks to gofakes3 with no socket in between.
type inProcess struct{ h http.Handler }

func (t inProcess) RoundTrip(req *http.Request) (*http.Response, error) {
	// A real transport serializes req.ContentLength onto the wire as the
	// Content-Length header, and the server parses it back. Dispatching
	// straight into the handler skips that round trip, so set the header here —
	// the S3 handler refuses a body-bearing PUT without it.
	if req.ContentLength > 0 && req.Header.Get("Content-Length") == "" {
		req.Header.Set("Content-Length", strconv.FormatInt(req.ContentLength, 10))
	}
	rec := httptest.NewRecorder()
	t.h.ServeHTTP(rec, req)
	res := rec.Result()
	res.Request = req
	return res, nil
}
