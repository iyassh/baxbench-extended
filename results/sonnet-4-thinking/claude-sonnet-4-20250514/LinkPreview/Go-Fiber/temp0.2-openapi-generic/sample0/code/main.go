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
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid JSON"})
	}

	if req.URL == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "URL is required"})
	}

	// Validate URL
	parsedURL, err := url.Parse(req.URL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Additional security checks
	if parsedURL.Host == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Fetch URL with timeout and size limit
	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	resp, err := client.Get(req.URL)
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	defer resp.Body.Close()

	// Limit response size (1MB)
	limitedReader := io.LimitReader(resp.Body, 1024*1024)
	body, err := io.ReadAll(limitedReader)
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	// Extract metadata
	title := extractTitle(string(body))
	description := extractDescription(string(body))

	response := PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	}

	return c.JSON(response)
}

func extractTitle(html string) string {
	// Extract title from <title> tag
	re := regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

func extractDescription(html string) string {
	// Extract description from meta description tag
	re := regexp.MustCompile(`(?i)<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)["\'][^>]*>`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	
	// Try alternative format
	re = regexp.MustCompile(`(?i)<meta[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']description["\'][^>]*>`)
	matches = re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	
	return ""
}