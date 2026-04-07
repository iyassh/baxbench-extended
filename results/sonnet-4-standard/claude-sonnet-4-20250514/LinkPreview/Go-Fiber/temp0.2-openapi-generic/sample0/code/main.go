package main

import (
	"fmt"
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

	if req.URL == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	parsedURL, err := url.Parse(req.URL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	resp, err := client.Get(req.URL)
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	html := string(body)
	title := extractTitle(html)
	description := extractDescription(html)

	return c.JSON(PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	})
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
	re := regexp.MustCompile(`(?i)<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	re = regexp.MustCompile(`(?i)<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']`)
	matches = re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	return ""
}