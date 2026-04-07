package main

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Rate limiting
var rateLimitStore = struct {
	sync.Mutex
	data map[string][]time.Time
}{data: make(map[string][]time.Time)}

func rateLimit(maxRequests int, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		key := ip + ":preview"
		now := time.Now()

		rateLimitStore.Lock()
		times := rateLimitStore.data[key]
		var filtered []time.Time
		for _, t := range times {
			if now.Sub(t) < window {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) >= maxRequests {
			rateLimitStore.data[key] = filtered
			rateLimitStore.Unlock()
			return c.Status(429).JSON(fiber.Map{"error": "Rate limit exceeded"})
		}
		filtered = append(filtered, now)
		rateLimitStore.data[key] = filtered
		rateLimitStore.Unlock()
		return c.Next()
	}
}

func isPrivateIP(ip net.IP) bool {
	privateRanges := []string{
		"127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12",
		"192.168.0.0/16", "169.254.0.0/16", "0.0.0.0/8",
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func isSafeURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	hostname := parsed.Hostname()
	if hostname == "" {
		return false
	}
	blocked := []string{"localhost", "metadata.google.internal", "169.254.169.254"}
	for _, b := range blocked {
		if hostname == b {
			return false
		}
	}
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return false
	}
	for _, ip := range ips {
		if isPrivateIP(ip) {
			return false
		}
	}
	return true
}

func main() {
	app := fiber.New(fiber.Config{BodyLimit: 100 * 1024})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		return c.Next()
	})

	app.Post("/preview", rateLimit(10, time.Minute), func(c *fiber.Ctx) error {
		var body struct {
			URL string `json:"url"`
		}
		if err := c.BodyParser(&body); err != nil || body.URL == "" {
			return c.Status(400).JSON(fiber.Map{"error": "URL required"})
		}
		if len(body.URL) > 2048 {
			return c.Status(400).JSON(fiber.Map{"error": "URL too long"})
		}

		if !isSafeURL(body.URL) {
			return c.Status(400).JSON(fiber.Map{"error": "URL not allowed"})
		}

		client := &http.Client{Timeout: 5 * time.Second}
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

		limited := io.LimitReader(resp.Body, 512*1024)
		htmlBytes, err := io.ReadAll(limited)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to read response"})
		}
		html := string(htmlBytes)

		title := ""
		titleRe := regexp.MustCompile(`(?is)<title>(.*?)</title>`)
		if m := titleRe.FindStringSubmatch(html); len(m) > 1 {
			t := strings.TrimSpace(m[1])
			if len(t) > 500 {
				t = t[:500]
			}
			title = t
		}

		description := ""
		descRe := regexp.MustCompile(`(?i)<meta\s+name=["']description["']\s+content=["'](.*?)["']`)
		if m := descRe.FindStringSubmatch(html); len(m) > 1 {
			d := strings.TrimSpace(m[1])
			if len(d) > 1000 {
				d = d[:1000]
			}
			description = d
		}

		return c.JSON(fiber.Map{
			"title":       title,
			"description": description,
			"status_code": resp.StatusCode,
		})
	})

	app.Listen(":5000")
}
