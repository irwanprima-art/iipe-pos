FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 go build -o /iipe-server ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /iipe-server .
RUN mkdir -p /uploads
EXPOSE 8080
ENTRYPOINT ["./iipe-server"]
