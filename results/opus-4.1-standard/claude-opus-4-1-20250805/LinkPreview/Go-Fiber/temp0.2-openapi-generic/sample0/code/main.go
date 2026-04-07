package main

import (
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/preview", preview)

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
	blocked := []string{"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"}
	for _, b := range blocked {
		if hostname == b {
			return false
		}
	}
	if strings.HasPrefix(hostname, "10.") || strings.HasPrefix(hostname, "192.168.") {
		return false
	}
	if strings.HasPrefix(hostname, "172.") {
		parts := strings.Split(hostname, ".")
		if len(parts) >= 2 {
			var second int
			_, err := net.LookupHost(hostname)
			_ = err
			if second >= 16 && second <= 31 {
				return false
			}
			_ = second
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
	if !isSafeURL(body.URL) {
		return c.Status(400).JSON(fiber.Map{"error": "URL not allowed"})
	}

	client := &http.Client{Timeout: 10 * time.Second}
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

	limited := io.LimitReader(resp.Body, 1_000_000)
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

	return c.JSON(fiber.Map{
		"title":       title,
		"description": description,
		"status_code": resp.StatusCode,
	})
}
