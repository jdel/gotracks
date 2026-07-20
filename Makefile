BINARY      := gotracks
PKG         := .
DIST        := dist
VERSION     ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS     := -s -w -X main.version=$(VERSION)

IMAGE       ?= ghcr.io/jdel/gotracks
IMAGE_TAG   ?= $(VERSION)
PLATFORMS   ?= linux/amd64,linux/arm64

PLATFORMS_BIN := \
	linux/amd64 \
	linux/arm64 \
	darwin/amd64 \
	darwin/arm64 \
	windows/amd64

# Host platform, for picking the matching slice of the dist matrix.
HOST_OS   := $(shell go env GOOS)
HOST_ARCH := $(shell go env GOARCH)
EXE       := $(if $(filter windows,$(HOST_OS)),.exe,)

export CGO_ENABLED := 0

.PHONY: all build ui dist clean test test-race vet tidy docker docker-load buildx-setup help

all: build

# Build the host binary.
build: ui
	go build -trimpath -ldflags '$(LDFLAGS)' -o $(BINARY) $(PKG)

# Build the web UI into internal/web/dist so the Go binary can embed it.
# The output is committed to the repo so `go install` produces a binary with
# the embedded SPA — rerun this target and commit the result whenever the UI
# source changes.
ui:
	cd ui && npm ci && npm run build

test:
	go test . ./cmd/... ./internal/...
	cd ui && npm test

test-race:
	go test -race . ./cmd/... ./internal/...

vet:
	go vet . ./cmd/... ./internal/...

tidy:
	go mod tidy

# Cross-compile matrix.
dist: ui $(addprefix $(DIST)/,$(PLATFORMS_BIN))

# Pattern target: dist/<os>/<arch>/<binary>[.exe]
$(DIST)/%:
	@os=$(word 1,$(subst /, ,$*)); arch=$(word 2,$(subst /, ,$*)); \
	ext=$$( [ "$$os" = "windows" ] && echo .exe || echo ); \
	echo "building $$os/$$arch"; \
	GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags '$(LDFLAGS)' \
		-o $(DIST)/$$os/$$arch/$(BINARY)$$ext $(PKG)

buildx-setup:
	docker buildx inspect gotracks >/dev/null 2>&1 || \
		docker buildx create --name gotracks --use

docker: buildx-setup
	docker buildx build --platform $(PLATFORMS) \
		--build-arg VERSION=$(VERSION) \
		-t $(IMAGE):$(IMAGE_TAG) -t $(IMAGE):latest --push .

# Single-arch build loaded into the local daemon, for testing.
docker-load: buildx-setup
	docker buildx build --platform $(HOST_OS)/$(HOST_ARCH) \
		--build-arg VERSION=$(VERSION) \
		-t $(IMAGE):$(IMAGE_TAG) --load .

clean:
	rm -f $(BINARY)
	rm -rf $(DIST)

help:
	@echo "make build       build the host binary (runs ui first)"
	@echo "make ui          build the web UI into internal/web/dist"
	@echo "make dist        cross-compile the release matrix"
	@echo "make test        go tests + ui tests"
	@echo "make test-race   go tests with the race detector"
	@echo "make vet         go vet"
	@echo "make docker      build and push a multi-arch image"
	@echo "make docker-load build a single-arch image into the local daemon"
	@echo "make clean       remove build output"
