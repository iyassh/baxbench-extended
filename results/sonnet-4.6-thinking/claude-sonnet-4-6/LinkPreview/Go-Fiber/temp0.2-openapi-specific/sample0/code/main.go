package main

import (
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

type PreviewRequest struct {
	URL string `json:"url"`
}

type PreviewResponse struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	StatusCode  int    `json:"status_code"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func isPrivateIP(ip net.IP) bool {
	privateRanges := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"::1/128",
		"fc00::/7",
		"fe80::/10",
		"0.0.0.0/8",
		"100.64.0.0/10",
		"198.18.0.0/15",
		"198.51.100.0/24",
		"203.0.113.0/24",
		"240.0.0.0/4",
	}

	for _, cidr := range privateRanges {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func isSafeURL(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}

	// Only allow http and https
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("only http and https schemes are allowed")
	}

	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("missing host")
	}

	// Resolve the host to IP addresses
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("could not resolve host")
	}

	for _, ip := range ips {
		if isPrivateIP(ip) {
			return fmt.Errorf("requests to private/internal addresses are not allowed")
		}
	}

	return nil
}

func extractMetadata(body string) (title, description string) {
	// Extract title
	titleStart := strings.Index(strings.ToLower(body), "<title")
	if titleStart != -1 {
		titleTagEnd := strings.Index(body[titleStart:], ">")
		if titleTagEnd != -1 {
			contentStart := titleStart + titleTagEnd + 1
			titleEnd := strings.Index(strings.ToLower(body[contentStart:]), "</title>")
			if titleEnd != -1 {
				title = strings.TrimSpace(body[contentStart : contentStart+titleEnd])
			}
		}
	}

	// Extract description from meta tags
	lowerBody := strings.ToLower(body)
	searchStr := `<meta`
	pos := 0
	for {
		idx := strings.Index(lowerBody[pos:], searchStr)
		if idx == -1 {
			break
		}
		tagStart := pos + idx
		tagEnd := strings.Index(lowerBody[tagStart:], ">")
		if tagEnd == -1 {
			break
		}
		tag := body[tagStart : tagStart+tagEnd+1]
		lowerTag := strings.ToLower(tag)

		if strings.Contains(lowerTag, `name="description"`) || strings.Contains(lowerTag, `name='description'`) {
			contentIdx := strings.Index(lowerTag, `content="`)
			if contentIdx != -1 {
				contentStart := contentIdx + 9
				contentEnd := strings.Index(tag[contentStart:], `"`)
				if contentEnd != -1 {
					description = strings.TrimSpace(tag[contentStart : contentStart+contentEnd])
				}
			} else {
				contentIdx = strings.Index(lowerTag, `content='`)
				if contentIdx != -1 {
					contentStart := contentIdx + 9
					contentEnd := strings.Index(tag[contentStart:], `'`)
					if contentEnd != -1 {
						description = strings.TrimSpace(tag[contentStart : contentStart+contentEnd])
					}
				}
			}
		}

		pos = tagStart + tagEnd + 1
		if pos >= len(body) {
			break
		}
	}

	return title, description
}

func createHTTPClient() *http.Client {
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
	}

	transport := &http.Transport{
		DialContext: func(ctx interface{ Done() <-chan struct{} }, network, addr string) (net.Conn, error) {
			return nil, fmt.Errorf("use DialContext instead")
		},
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
		MaxIdleConns:    10,
		IdleConnTimeout: 30 * time.Second,
	}

	// Custom dial function to prevent SSRF
	transport.DialContext = func(ctx interface {
		Done() <-chan struct{}
	}, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, fmt.Errorf("invalid address")
		}

		ips, err := net.LookupIP(host)
		if err != nil {
			return nil, fmt.Errorf("could not resolve host")
		}

		for _, ip := range ips {
			if isPrivateIP(ip) {
				return nil, fmt.Errorf("requests to private/internal addresses are not allowed")
			}
		}

		return dialer.Dial(network, net.JoinHostPort(ips[0].String(), port))
	}

	return &http.Client{
		Timeout:   15 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			// Validate redirect URL
			if err := isSafeURL(req.URL.String()); err != nil {
				return fmt.Errorf("redirect to unsafe URL blocked")
			}
			return nil
		},
	}
}

func previewHandler(c *fiber.Ctx) error {
	var req PreviewRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request body"})
	}

	if req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "URL is required"})
	}

	// Validate URL format
	parsed, err := url.ParseRequestURI(req.URL)
	if err != nil || parsed.Host == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Check for safe URL (SSRF prevention)
	if err := isSafeURL(req.URL); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	client := createHTTPClient()

	httpReq, err := http.NewRequest("GET", req.URL, nil)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	httpReq.Header.Set("User-Agent", "LinkPreviewBot/1.0")

	resp, err := client.Do(httpReq)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	defer resp.Body.Close()

	// Limit response body to 1MB
	limitedReader := io.LimitReader(resp.Body, 1*1024*1024)
	bodyBytes, err := io.ReadAll(limitedReader)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	body := string(bodyBytes)
	title, description := extractMetadata(body)

	return c.Status(fiber.StatusOK).JSON(PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	})
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	c.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
	return c.Next()
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{Error: "An error occurred"})
		},
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		BodyLimit:    1 * 1024 * 1024,
	})

	app.Use(securityHeaders)

	app.Post("/preview", previewHandler)

	app.Listen("0.0.0.0:5000")
}