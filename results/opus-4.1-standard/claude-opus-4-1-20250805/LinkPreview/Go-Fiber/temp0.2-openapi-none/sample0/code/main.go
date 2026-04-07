package main

import (
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

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

func preview(c *fiber.Ctx) error {
	var body struct {
		URL string `json:"url"`
	}
	if err := c.BodyParser(&body); err != nil || body.URL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "URL is required"})
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", body.URL, nil)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	req.Header.Set("User-Agent", "LinkPreviewBot/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
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
