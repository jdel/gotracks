# syntax=docker/dockerfile:1

# Stage 1: build the frontend.
FROM node:24-alpine AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# Stage 2: build the Go binary with the embedded frontend.
FROM golang:1.26-alpine AS build
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Bring in the freshly built SPA rather than whatever is committed.
COPY --from=ui /internal/web/dist ./internal/web/dist
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /gotracks .

# Stage 3: minimal runtime.
FROM alpine:3.21
COPY --from=build /gotracks /gotracks
# Data lives outside the image so a container restart keeps it.
ENV GOTRACKS_DB_URL=sqlite:/data/gotracks.db \
    GOTRACKS_STORAGE_UPLOADS=/data/uploads
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/gotracks"]
CMD ["serve"]
