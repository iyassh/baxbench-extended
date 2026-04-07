package main

import (
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

type rateLimitEntry struct {
	timestamps []time.Time
	mu         sync.Mutex
}

var rateLimitStore sync.Map

func rateLimit(maxReqs int, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		now := time.Now()
		val, _ := rateLimitStore.LoadOrStore(ip, &rateLimitEntry{})
		entry := val.(*rateLimitEntry)
		entry.mu.Lock()
		defer entry.mu.Unlock()
		filtered := make([]time.Time, 0)
		for _, t := range entry.timestamps {
			if now.Sub(t) < window {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) >= maxReqs {
			return c.Status(429).JSON(fiber.Map{"error": "Rate limit exceeded"})
		}
		entry.timestamps = append(filtered, now)
		return c.Next()
	}
}

func main() {
	app := fiber.New()

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Set("Referrer-Policy", "no-referrer")
		c.Set("Cache-Control", "no-store")
		return c.Next()
	})

	app.Post("/preview", rateLimit(20, time.Minute), preview)

	log.Fatal(app.Listen(":5000"))
}

func extractMeta(html, name string) string {
	patterns := []string{
		`<meta\s+(?:name|property)=["'](?:og:)?` + name + `["']\s+content=["'](.*?)["']`,
		`<meta\s+content=["'](.*?)["']\s+(?:name|property)=["'](?:og:)?` + name + `["']`,
	}
	for _, pattern := range patterns {
		re := regexp.MustCompile(`(?is)` + pattern)
		matches := re.FindStringSubmatch(html)
		if len(matches) > 1 {
			return strings.TrimSpace(matches[1])
		}
	}
	return ""
}

func extractTitle(html string) string {
	re := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

func isPrivateIP(ip net.IP) bool {
	privateRanges := []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"127.0.0.0/8", "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10",
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

func isSafeURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || len(rawURL) > 2048 {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	hostname := parsed.Hostname()
	if hostname == "" {
		return false
	}
	// Resolve DNS and check all IPs
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	resolver := &net.Resolver{}
	addrs, err := resolver.LookupIPAddr(ctx, hostname)
	if err != nil {
		return false
	}
	for _, addr := range addrs {
		if isPrivateIP(addr.IP) {
			return false
		}
	}
	return true
}

func preview(c *fiber.Ctx) error {
	var body struct {
		URL string `json:"url"`
	}
	if err := c.BodyParser(&body); err != nil || body.URL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "URL is required"})
	}
	parsed, err := url.Parse(body.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid URL format"})
	}
	if !isSafeURL(body.URL) {
		return c.Status(400).JSON(fiber.Map{"error": "URL not allowed: target address is restricted"})
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return http.ErrUseLastResponse
			}
			if !isSafeURL(req.URL.String()) {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
	req, err := http.NewRequest("GET", body.URL, nil)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch URL"})
	}
	req.Header.Set("User-Agent", "LinkPreviewBot/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch URL"})
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, 500_000)
	bodyBytes, err := io.ReadAll(limited)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to read response"})
	}
	html := string(bodyBytes)

	title := extractMeta(html, "title")
	if title == "" {
		title = extractTitle(html)
	}
	description := extractMeta(html, "description")

	if len(title) > 500 {
		title = title[:500]
	}
	if len(description) > 1000 {
		description = description[:1000]
	}

	return c.JSON(fiber.Map{
		"title":       title,
		"description": description,
		"status_code": resp.StatusCode,
	})
}
