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

const maxBodySize = 10 * 1024 * 1024

func extractTitle(htmlContent string) string {
	re := regexp.MustCompile(`(?i)<title[^>]*>([^<]*)</title>`)
	matches := re.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return html.UnescapeString(strings.TrimSpace(matches[1]))
	}
	return ""
}

func extractDescription(htmlContent string) string {
	re := regexp.MustCompile(`(?i)<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>`)
	matches := re.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return html.UnescapeString(strings.TrimSpace(matches[1]))
	}
	
	re = regexp.MustCompile(`(?i)<meta[^>]*name='description'[^>]*content='([^']*)'[^>]*>`)
	matches = re.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return html.UnescapeString(strings.TrimSpace(matches[1]))
	}
	
	re = regexp.MustCompile(`(?i)<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>`)
	matches = re.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return html.UnescapeString(strings.TrimSpace(matches[1]))
	}
	
	re = regexp.MustCompile(`(?i)<meta[^>]*content='([^']*)'[^>]*name='description'[^>]*>`)
	matches = re.FindStringSubmatch(htmlContent)
	if len(matches) > 1 {
		return html.UnescapeString(strings.TrimSpace(matches[1]))
	}
	
	return ""
}

func main() {
	app := fiber.New()

	app.Post("/preview", func(c *fiber.Ctx) error {
		var req PreviewRequest
		
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(ErrorResponse{
				Error: "Invalid or missing URL",
			})
		}

		if req.URL == "" {
			return c.Status(400).JSON(ErrorResponse{
				Error: "Invalid or missing URL",
			})
		}

		parsedURL, err := url.ParseRequestURI(req.URL)
		if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
			return c.Status(400).JSON(ErrorResponse{
				Error: "Invalid or missing URL",
			})
		}

		client := &http.Client{
			Timeout: 10 * time.Second,
		}

		resp, err := client.Get(req.URL)
		if err != nil {
			return c.Status(422).JSON(ErrorResponse{
				Error: "Could not fetch the provided URL",
			})
		}
		defer resp.Body.Close()

		limitedReader := io.LimitReader(resp.Body, maxBodySize)
		body, err := io.ReadAll(limitedReader)
		if err != nil {
			return c.Status(422).JSON(ErrorResponse{
				Error: "Could not fetch the provided URL",
			})
		}

		htmlContent := string(body)

		title := extractTitle(htmlContent)
		description := extractDescription(htmlContent)

		return c.JSON(PreviewResponse{
			Title:       title,
			Description: description,
			StatusCode:  resp.StatusCode,
		})
	})

	app.Listen("0.0.0.0:5000")
}