package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2 stores objects in a Cloudflare R2 bucket through its S3-compatible API.
type R2 struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

func NewR2(accountID, accessKeyID, secretKey, bucket string) *R2 {
	client := s3.New(s3.Options{
		Region:       "auto",
		BaseEndpoint: aws.String("https://" + accountID + ".r2.cloudflarestorage.com"),
		Credentials:  credentials.NewStaticCredentialsProvider(accessKeyID, secretKey, ""),
		// R2 does not accept every checksum the SDK sends by default.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})
	return &R2{client: client, presign: s3.NewPresignClient(client), bucket: bucket}
}

func (s *R2) Put(ctx context.Context, key string, body io.ReadSeeker, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          body,
		ContentLength: aws.Int64(size),
		ContentType:   aws.String(contentType),
	})
	return err
}

func (s *R2) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	return err
}

// Serve proxies the requested byte range from R2. Prefer PresignGet in
// production: proxying moves the bandwidth bill from R2 (free egress) to
// whoever hosts this server.
func (s *R2) Serve(w http.ResponseWriter, r *http.Request, key, contentType string) {
	in := &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)}
	if rg := r.Header.Get("Range"); rg != "" {
		in.Range = aws.String(rg)
	}
	out, err := s.client.GetObject(r.Context(), in)
	if err != nil {
		var re *awshttp.ResponseError
		if errors.As(err, &re) {
			switch re.HTTPStatusCode() {
			case http.StatusNotFound:
				http.NotFound(w, r)
				return
			case http.StatusRequestedRangeNotSatisfiable:
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}
		}
		http.Error(w, "storage unavailable", http.StatusBadGateway)
		return
	}
	defer out.Body.Close()

	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Accept-Ranges", "bytes")
	if out.ContentLength != nil {
		h.Set("Content-Length", strconv.FormatInt(*out.ContentLength, 10))
	}
	if out.ETag != nil {
		h.Set("ETag", *out.ETag)
	}
	status := http.StatusOK
	if out.ContentRange != nil {
		h.Set("Content-Range", *out.ContentRange)
		status = http.StatusPartialContent
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		io.Copy(w, out.Body)
	}
}

func (s *R2) PresignGet(ctx context.Context, key, contentType string, ttl time.Duration) (string, error) {
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket:              aws.String(s.bucket),
		Key:                 aws.String(key),
		ResponseContentType: aws.String(contentType),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}
