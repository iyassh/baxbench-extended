package main

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
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

	// Security middleware
	app.Use(helmet.New())

	app.Post("/preview", handlePreview)

	app.Listen("0.0.0.0:5000")
}

func handlePreview(c *fiber.Ctx) error {
	var req PreviewRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	if req.URL == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Validate and sanitize URL
	if !isValidURL(req.URL) {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Check for SSRF
	if !isSafeURL(req.URL) {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Fetch the URL
	preview, err := fetchPreview(req.URL)
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	return c.JSON(preview)
}

func isValidURL(urlStr string) bool {
	u, err := url.Parse(urlStr)
	if err != nil {
		return false
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}

	if u.Host == "" {
		return false
	}

	return true
}

func isSafeURL(urlStr string) bool {
	u, err := url.Parse(urlStr)
	if err != nil {
		return false
	}

	// Resolve the hostname to IP
	ips, err := net.LookupIP(u.Hostname())
	if err != nil {
		return false
	}

	// Check if any of the IPs are private/localhost
	for _, ip := range ips {
		if isPrivateIP(ip) {
			return false
		}
	}

	return true
}

func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}

	// Check for private IP ranges
	private := []*net.IPNet{
		{IP: net.IPv4(10, 0, 0, 0), Mask: net.CIDRMask(8, 32)},     // 10.0.0.0/8
		{IP: net.IPv4(172, 16, 0, 0), Mask: net.CIDRMask(12, 32)},  // 172.16.0.0/12
		{IP: net.IPv4(192, 168, 0, 0), Mask: net.CIDRMask(16, 32)}, // 192.168.0.0/16
		{IP: net.ParseIP("fc00::"), Mask: net.CIDRMask(7, 128)},    // fc00::/7 (unique local)
	}

	for _, cidr := range private {
		if cidr.Contains(ip) {
			return true
		}
	}

	return false
}

func fetchPreview(urlStr string) (*PreviewResponse, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Limit redirects to 10
			if len(via) >= 10 {
				return http.ErrUseLastResponse
			}

			// Check if redirect target is safe
			u := req.URL
			ips, err := net.LookupIP(u.Hostname())
			if err != nil {
				return http.ErrUseLastResponse
			}

			for _, ip := range ips {
				if isPrivateIP(ip) {
					return http.ErrUseLastResponse
				}
			}

			return nil
		},
	}

	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "LinkPreview/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Limit response size to 1MB
	limitedReader := io.LimitReader(resp.Body, 1024*1024)
	body, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, err
	}

	title := extractTitle(string(body))
	description := extractDescription(string(body))

	return &PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	}, nil
}

func extractTitle(html string) string {
	re := regexp.MustCompile(`(?i)<title[^>]*>([^<]*)</title>`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

func extractDescription(html string) string {
	// Try meta description first
	re := regexp.MustCompile(`(?i)<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*?)["']`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	// Try content first, then name
	re = regexp.MustCompile(`(?i)<meta[^>]*content\s*=\s*["']([^"']*?)["'][^>]*name\s*=\s*["']description["']`)
	matches = re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	// Try og:description
	re = regexp.MustCompile(`(?i)<meta[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*?)["']`)
	matches = re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	// Try og:description with content first
	re = regexp.MustCompile(`(?i)<meta[^>]*content\s*=\s*["']([^"']*?)["'][^>]*property\s*=\s*["']og:description["']`)
	matches = re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	return ""
}