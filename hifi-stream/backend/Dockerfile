FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -H app && mkdir -p /data/media && chown -R app /data
COPY --from=build /out/server /usr/local/bin/server
USER app
ENV LOCAL_STORAGE_DIR=/data/media
EXPOSE 8080
ENTRYPOINT ["server"]
