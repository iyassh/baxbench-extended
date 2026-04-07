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
	})

	// Security headers middleware
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
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid request body",
		})
	}

	if req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "URL is required",
		})
	}

	// Parse and validate URL
	parsedURL, err := url.Parse(req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid URL provided",
		})
	}

	// Validate URL scheme
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid URL provided",
		})
	}

	// Prevent SSRF by checking if URL points to private/local addresses
	if isPrivateOrLocalAddress(parsedURL.Host) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid URL provided",
		})
	}

	// Fetch the URL with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req2, err := http.NewRequestWithContext(ctx, "GET", req.URL, nil)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{
			Error: "Could not fetch the provided URL",
		})
	}

	// Set a user agent to avoid being blocked by some sites
	req2.Header.Set("User-Agent", "LinkPreviewAPI/1.0")

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			// Check each redirect URL for SSRF
			if isPrivateOrLocalAddress(req.URL.Host) {
				return fmt.Errorf("redirect to private address")
			}
			return nil
		},
	}

	resp, err := client.Do(req2)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{
			Error: "Could not fetch the provided URL",
		})
	}
	defer resp.Body.Close()

	// Read body with size limit to prevent memory exhaustion
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024)) // 1MB limit
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{
			Error: "Could not fetch the provided URL",
		})
	}

	// Extract title and description
	title := extractTitle(string(body))
	description := extractDescription(string(body))

	return c.JSON(PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	})
}

func isPrivateOrLocalAddress(host string) bool {
	// Remove port if present
	h, _, err := net.SplitHostPort(host)
	if err == nil {
		host = h
	}

	// Check for localhost and special addresses
	if host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0" || host == "::" {
		return true
	}

	// Parse IP address
	ip := net.ParseIP(host)
	if ip == nil {
		// If not an IP, resolve it
		ips, err := net.LookupIP(host)
		if err != nil || len(ips) == 0 {
			return false
		}
		ip = ips[0]
	}

	// Check for private IP ranges
	privateRanges := []string{
		"0.0.0.0/8",       // Special use
		"127.0.0.0/8",     // Loopback
		"10.0.0.0/8",      // Private
		"172.16.0.0/12",   // Private
		"192.168.0.0/16",  // Private
		"169.254.0.0/16",  // Link-local
		"::1/128",         // IPv6 loopback
		"fc00::/7",        // IPv6 private
		"fe80::/10",       // IPv6 link-local
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

func extractTitle(html string) string {
	// Simple regex to extract title
	titleRegex := regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
	matches := titleRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

func extractDescription(html string) string {
	// Extract meta description
	descRegex := regexp.MustCompile(`(?i)<meta\s+name=["']description["']\s+content=["']([^"']+)["']`)
	matches := descRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	// Also check for content before name
	descRegex2 := regexp.MustCompile(`(?i)<meta\s+content=["']([^"']+)["']\s+name=["']description["']`)
	matches = descRegex2.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	return ""
}