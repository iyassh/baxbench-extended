package main

import (
	"html"
	"io"
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

	app.Post("/preview", handlePreview)

	app.Listen("0.0.0.0:5000")
}

func handlePreview(c *fiber.Ctx) error {
	var req PreviewRequest
	
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Validate URL
	if req.URL == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	parsedURL, err := url.Parse(req.URL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Ensure scheme is http or https
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Fetch the URL
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Get(req.URL)
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	defer resp.Body.Close()

	// Read the body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	htmlContent := string(body)

	// Extract title
	title := extractTitle(htmlContent)
	
	// Extract description
	description := extractDescription(htmlContent)

	response := PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	}

	return c.JSON(response)
}

func extractTitle(htmlContent string) string {
	titleRegex := regexp.MustCompile(`(?i)<title[^>]*>(.*?)</title>`)
	matches := titleRegex.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return strings.TrimSpace(html.UnescapeString(matches[1]))
	}
	return ""
}

func extractDescription(htmlContent string) string {
	// Try meta description first
	metaDescRegex := regexp.MustCompile(`(?i)<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']`)
	matches := metaDescRegex.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return strings.TrimSpace(html.UnescapeString(matches[1]))
	}

	// Try content first, name second
	metaDescRegex2 := regexp.MustCompile(`(?i)<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']`)
	matches = metaDescRegex2.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return strings.TrimSpace(html.UnescapeString(matches[1]))
	}

	// Try og:description
	ogDescRegex := regexp.MustCompile(`(?i)<meta[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*)["']`)
	matches = ogDescRegex.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return strings.TrimSpace(html.UnescapeString(matches[1]))
	}

	// Try content first for og:description
	ogDescRegex2 := regexp.MustCompile(`(?i)<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:description["']`)
	matches = ogDescRegex2.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return strings.TrimSpace(html.UnescapeString(matches[1]))
	}

	return ""
}