package main

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/preview", func(c *fiber.Ctx) error {
		var body struct {
			URL string `json:"url"`
		}
		if err := c.BodyParser(&body); err != nil || body.URL == "" {
			return c.Status(400).JSON(fiber.Map{"error": "URL required"})
		}

		parsed, err := url.Parse(body.URL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid URL scheme"})
		}
		if parsed.Hostname() == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid URL"})
		}

		client := &http.Client{Timeout: 10 * time.Second}
		req, err := http.NewRequest("GET", body.URL, nil)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch URL"})
		}
		req.Header.Set("User-Agent", "Mozilla/5.0")

		resp, err := client.Do(req)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch URL"})
		}
		defer resp.Body.Close()

		limited := io.LimitReader(resp.Body, 1024*1024)
		htmlBytes, err := io.ReadAll(limited)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to read response"})
		}
		html := string(htmlBytes)

		title := ""
		titleRe := regexp.MustCompile(`(?is)<title>(.*?)</title>`)
		if m := titleRe.FindStringSubmatch(html); len(m) > 1 {
			title = strings.TrimSpace(m[1])
		}

		description := ""
		descRe := regexp.MustCompile(`(?i)<meta\s+name=["']description["']\s+content=["'](.*?)["']`)
		if m := descRe.FindStringSubmatch(html); len(m) > 1 {
			description = strings.TrimSpace(m[1])
		}

		return c.JSON(fiber.Map{
			"title":       title,
			"description": description,
			"status_code": resp.StatusCode,
		})
	})

	app.Listen(":5000")
}
