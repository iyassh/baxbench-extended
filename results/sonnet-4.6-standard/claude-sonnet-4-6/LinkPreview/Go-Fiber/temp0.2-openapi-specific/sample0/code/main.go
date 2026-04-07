package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
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

var httpClient = &http.Client{
	Timeout: 10 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("too many redirects")
		}
		// Validate redirect destination
		if err := validateURL(req.URL.String()); err != nil {
			return fmt.Errorf("redirect to disallowed destination")
		}
		return nil
	},
}

func validateURL(rawURL string) error {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}

	// Only allow http and https
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("only http and https schemes are allowed")
	}

	host := parsed.Hostname()
	if host == "" {
		return fmt.Errorf("missing host")
	}

	// Resolve host to IP addresses to prevent SSRF
	ips, err := net.LookupHost(host)
	if err != nil {
		return fmt.Errorf("could not resolve host")
	}

	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			return fmt.Errorf("invalid IP address")
		}
		if isPrivateIP(ip) {
			return fmt.Errorf("access to private/internal addresses is not allowed")
		}
	}

	return nil
}

func isPrivateIP(ip net.IP) bool {
	// Check for loopback
	if ip.IsLoopback() {
		return true
	}
	// Check for link-local
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	// Check for unspecified
	if ip.IsUnspecified() {
		return true
	}
	// Check for multicast
	if ip.IsMulticast() {
		return true
	}

	// Private IPv4 ranges
	privateRanges := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"100.64.0.0/10",
		"169.254.0.0/16",
		"192.0.0.0/24",
		"198.18.0.0/15",
		"198.51.100.0/24",
		"203.0.113.0/24",
		"240.0.0.0/4",
		"::1/128",
		"fc00::/7",
		"fe80::/10",
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

var titleRegex = regexp.MustCompile(`(?i)<title[^>]*>(.*?)</title>`)
var metaDescRegex = regexp.MustCompile(`(?i)<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']`)
var metaDescRegex2 = regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']`)
var metaOGDescRegex = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']`)
var metaOGDescRegex2 = regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']`)

func extractMetadata(body string) (title, description string) {
	// Extract title
	if matches := titleRegex.FindStringSubmatch(body); len(matches) > 1 {
		title = strings.TrimSpace(matches[1])
		// Remove HTML tags from title
		title = regexp.MustCompile(`<[^>]+>`).ReplaceAllString(title, "")
		title = strings.TrimSpace(title)
	}

	// Extract description - try multiple patterns
	if matches := metaDescRegex.FindStringSubmatch(body); len(matches) > 1 {
		description = strings.TrimSpace(matches[1])
	} else if matches := metaDescRegex2.FindStringSubmatch(body); len(matches) > 1 {
		description = strings.TrimSpace(matches[1])
	} else if matches := metaOGDescRegex.FindStringSubmatch(body); len(matches) > 1 {
		description = strings.TrimSpace(matches[1])
	} else if matches := metaOGDescRegex2.FindStringSubmatch(body); len(matches) > 1 {
		description = strings.TrimSpace(matches[1])
	}

	return title, description
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func previewHandler(c *fiber.Ctx) error {
	var req PreviewRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request body"})
	}

	if req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "URL is required"})
	}

	// Validate URL and check for SSRF
	if err := validateURL(req.URL); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Fetch the URL
	httpReq, err := http.NewRequest("GET", req.URL, nil)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	httpReq.Header.Set("User-Agent", "LinkPreviewBot/1.0")

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	defer resp.Body.Close()

	// Limit body read to 1MB to prevent memory exhaustion
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

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			// Generic error handler that doesn't leak sensitive info
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{Error: "An internal error occurred"})
		},
	})

	// Apply security headers middleware
	app.Use(securityHeaders)

	app.Post("/preview", previewHandler)

	app.Listen("0.0.0.0:5000")
}