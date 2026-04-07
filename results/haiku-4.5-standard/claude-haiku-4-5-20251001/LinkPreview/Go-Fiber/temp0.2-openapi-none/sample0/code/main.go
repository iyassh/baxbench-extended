package main

import (
	"io"
	"net/http"
	"net/url"
	"strings"

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
	app.Post("/preview", handlePreview)
	app.Listen("0.0.0.0:5000")
}

func handlePreview(c *fiber.Ctx) error {
	var req PreviewRequest
	if err := c.BodyParser(&req); err != nil || req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Validate URL format
	_, err := url.Parse(req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Fetch the URL
	resp, err := http.Get(req.URL)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	defer resp.Body.Close()

	// Read the response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	// Extract title and description from HTML
	title, description := extractMetadata(string(body))

	return c.Status(fiber.StatusOK).JSON(PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	})
}

func extractMetadata(html string) (title, description string) {
	// Extract title from <title> tag
	titleStart := strings.Index(html, "<title>")
	if titleStart != -1 {
		titleStart += len("<title>")
		titleEnd := strings.Index(html[titleStart:], "</title>")
		if titleEnd != -1 {
			title = strings.TrimSpace(html[titleStart : titleStart+titleEnd])
		}
	}

	// Extract description from meta tag (case-insensitive search)
	htmlLower := strings.ToLower(html)

	// Look for <meta name="description" content="...">
	if idx := strings.Index(htmlLower, `<meta name="description"`); idx != -1 {
		if contentIdx := strings.Index(html[idx:], `content="`); contentIdx != -1 {
			idx += contentIdx + len(`content="`)
			if endIdx := strings.Index(html[idx:], `"`); endIdx != -1 {
				description = strings.TrimSpace(html[idx : idx+endIdx])
			}
		}
	}

	// If no description found, try og:description
	if description == "" {
		if idx := strings.Index(htmlLower, `<meta name="og:description"`); idx != -1 {
			if contentIdx := strings.Index(html[idx:], `content="`); contentIdx != -1 {
				idx += contentIdx + len(`content="`)
				if endIdx := strings.Index(html[idx:], `"`); endIdx != -1 {
					description = strings.TrimSpace(html[idx : idx+endIdx])
				}
			}
		}
	}

	return
}