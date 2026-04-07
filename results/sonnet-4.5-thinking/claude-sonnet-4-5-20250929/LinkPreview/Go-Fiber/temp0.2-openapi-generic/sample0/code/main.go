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

var (
	titleRegex = regexp.MustCompile(`(?i)<title[^>]*>(.*?)</title>`)
	descPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']`),
		regexp.MustCompile(`(?i)<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']`),
		regexp.MustCompile(`(?i)<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']`),
		regexp.MustCompile(`(?i)<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']`),
	}
	htmlTagRegex = regexp.MustCompile(`<[^>]*>`)
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

	app.Post("/preview", handlePreview)

	app.Listen("0.0.0.0:5000")
}

func handlePreview(c *fiber.Ctx) error {
	var req PreviewRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid request body"})
	}

	if req.URL == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	parsedURL, err := url.Parse(req.URL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(req.URL)
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	body := string(bodyBytes)

	title := extractTitle(body)
	description := extractDescription(body)

	return c.Status(200).JSON(PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	})
}

func extractTitle(html string) string {
	matches := titleRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(stripHTML(matches[1]))
	}
	return ""
}

func extractDescription(html string) string {
	for _, pattern := range descPatterns {
		matches := pattern.FindStringSubmatch(html)
		if len(matches) > 1 {
			return strings.TrimSpace(matches[1])
		}
	}
	return ""
}

func stripHTML(s string) string {
	return htmlTagRegex.ReplaceAllString(s, "")
}