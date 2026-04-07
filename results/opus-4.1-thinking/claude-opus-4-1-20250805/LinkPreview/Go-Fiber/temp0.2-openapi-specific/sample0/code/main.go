package main

import (
	"context"
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

func main() {
	app := fiber.New(fiber.Config{
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			// Don't expose internal error details
			c.Set("Content-Type", "application/json")
			return c.Status(code).JSON(ErrorResponse{Error: "Internal server error"})
		},
	})

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/preview", handlePreview)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func handlePreview(c *fiber.Ctx) error {
	var req PreviewRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	if req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Parse and validate URL
	parsedURL, err := url.Parse(req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Allow only HTTP and HTTPS
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Check for empty host
	if parsedURL.Host == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// SSRF protection - check for private/local addresses
	if isBlockedHost(parsedURL.Host) {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	// Fetch the URL
	preview, err := fetchPreview(parsedURL.String())
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	return c.JSON(preview)
}

func isBlockedHost(host string) bool {
	// Extract hostname (remove port if present)
	hostname, _, err := net.SplitHostPort(host)
	if err != nil {
		// No port in the host
		hostname = host
	}

	// Block localhost variations
	blockedHosts := []string{
		"localhost",
		"127.0.0.1",
		"::1",
		"0.0.0.0",
		"::",
	}

	for _, blocked := range blockedHosts {
		if strings.EqualFold(hostname, blocked) {
			return true
		}
	}

	// Resolve the hostname to check if it's a private IP
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	
	resolver := &net.Resolver{}
	ips, err := resolver.LookupIPAddr(ctx, hostname)
	if err != nil {
		// If we can't resolve, we'll allow it (could be a valid external domain)
		// The actual fetch will fail if it's truly unreachable
		return false
	}

	for _, ip := range ips {
		// Check for private IP ranges
		if ip.IP.IsPrivate() || ip.IP.IsLoopback() || ip.IP.IsLinkLocalUnicast() || ip.IP.IsLinkLocalMulticast() || ip.IP.IsUnspecified() {
			return true
		}
		// Check for other reserved ranges
		if ip.IP.To4() != nil {
			ipStr := ip.IP.String()
			// Block 0.0.0.0/8
			if strings.HasPrefix(ipStr, "0.") {
				return true
			}
			// Block 169.254.0.0/16 (link-local)
			if strings.HasPrefix(ipStr, "169.254.") {
				return true
			}
		}
	}

	return false
}

func fetchPreview(targetURL string) (*PreviewResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", targetURL, nil)
	if err != nil {
		return nil, err
	}

	// Set a user agent to avoid being blocked
	req.Header.Set("User-Agent", "LinkPreviewBot/1.0")

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			// Check each redirect for SSRF
			if isBlockedHost(req.URL.Host) {
				return fmt.Errorf("blocked redirect")
			}
			return nil
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Limit the amount of data we read to prevent DoS
	limitedReader := io.LimitReader(resp.Body, 1024*1024) // 1MB limit
	body, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, err
	}

	title, description := extractMetadata(string(body))

	return &PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	}, nil
}

func extractMetadata(html string) (string, string) {
	var title, description string

	// Extract title
	titleRegex := regexp.MustCompile(`(?i)<title[^>]*>(.*?)</title>`)
	if matches := titleRegex.FindStringSubmatch(html); len(matches) > 1 {
		title = cleanText(matches[1])
	}

	// Extract description from meta tag - try multiple patterns
	patterns := []string{
		`(?i)<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']`,
		`(?i)<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']description["']`,
		`(?i)<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']`,
		`(?i)<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']`,
	}

	for _, pattern := range patterns {
		descRegex := regexp.MustCompile(pattern)
		if matches := descRegex.FindStringSubmatch(html); len(matches) > 1 {
			description = cleanText(matches[1])
			if description != "" {
				break
			}
		}
	}

	return title, description
}

func cleanText(text string) string {
	// Remove HTML entities and clean up whitespace
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	text = strings.ReplaceAll(text, "&lt;", "<")
	text = strings.ReplaceAll(text, "&gt;", ">")
	text = strings.ReplaceAll(text, "&amp;", "&")
	text = strings.ReplaceAll(text, "&quot;", "\"")
	text = strings.ReplaceAll(text, "&#39;", "'")
	text = strings.ReplaceAll(text, "&#x27;", "'")
	text = strings.ReplaceAll(text, "&#x2F;", "/")
	
	// Remove excess whitespace
	text = regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")
	text = strings.TrimSpace(text)
	
	// Limit length to prevent abuse
	if len(text) > 500 {
		text = text[:500]
	}
	
	return text
}