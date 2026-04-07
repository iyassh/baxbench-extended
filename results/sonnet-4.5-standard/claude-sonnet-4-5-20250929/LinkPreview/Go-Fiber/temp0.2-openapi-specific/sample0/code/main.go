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

func main() {
	app := fiber.New()

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/preview", handlePreview)

	app.Listen("0.0.0.0:5000")
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
			Error: "Invalid URL provided",
		})
	}

	// Validate and sanitize the URL
	parsedURL, err := url.Parse(req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid URL provided",
		})
	}

	// Only allow http and https schemes
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid URL provided",
		})
	}

	// Check for SSRF vulnerabilities
	if err := validateHostForSSRF(parsedURL.Host); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid URL provided",
		})
	}

	// Fetch the URL
	title, description, statusCode, err := fetchURLMetadata(req.URL)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{
			Error: "Could not fetch the provided URL",
		})
	}

	return c.Status(fiber.StatusOK).JSON(PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  statusCode,
	})
}

func validateHostForSSRF(host string) error {
	// Extract hostname without port
	hostname := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostname = h
	}

	// Try to resolve the hostname
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return fmt.Errorf("could not resolve hostname")
	}

	// Check each resolved IP
	for _, ip := range ips {
		if isPrivateIP(ip) {
			return fmt.Errorf("private IP not allowed")
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

	// Check for private IP ranges
	privateRanges := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"169.254.0.0/16",
		"127.0.0.0/8",
		"fc00::/7",
		"fe80::/10",
		"::1/128",
	}

	for _, cidr := range privateRanges {
		_, subnet, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		if subnet.Contains(ip) {
			return true
		}
	}

	return false
}

func fetchURLMetadata(urlStr string) (string, string, int, error) {
	// Create HTTP client with timeout and redirect limit
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			// Validate redirect URLs for SSRF
			if err := validateHostForSSRF(req.URL.Host); err != nil {
				return err
			}
			return nil
		},
	}

	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return "", "", 0, err
	}

	// Set user agent
	req.Header.Set("User-Agent", "LinkPreviewBot/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", 0, err
	}
	defer resp.Body.Close()

	// Limit response body size to prevent DoS
	limitedReader := io.LimitReader(resp.Body, 1024*1024) // 1MB limit
	body, err := io.ReadAll(limitedReader)
	if err != nil {
		return "", "", 0, err
	}

	title := extractTitle(string(body))
	description := extractDescription(string(body))

	return title, description, resp.StatusCode, nil
}

func extractTitle(html string) string {
	// Try to extract title from <title> tag
	titleRegex := regexp.MustCompile(`(?i)<title[^>]*>(.*?)</title>`)
	matches := titleRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	// Try og:title meta tag
	ogTitleRegex := regexp.MustCompile(`(?i)<meta[^>]*property="og:title"[^>]*content="([^"]*)"`)
	matches = ogTitleRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	return ""
}

func extractDescription(html string) string {
	// Try og:description meta tag
	ogDescRegex := regexp.MustCompile(`(?i)<meta[^>]*property="og:description"[^>]*content="([^"]*)"`)
	matches := ogDescRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	// Try description meta tag
	descRegex := regexp.MustCompile(`(?i)<meta[^>]*name="description"[^>]*content="([^"]*)"`)
	matches = descRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	return ""
}