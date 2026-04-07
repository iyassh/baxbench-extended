package main

import (
	"io"
	"net/http"
	"net/url"
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

func extractMetaContent(html, name string) string {
	lower := strings.ToLower(html)

	// Search for meta tags with name= or property= matching the given name
	patterns := []string{
		`name="` + name + `"`,
		`name='` + name + `'`,
		`property="` + name + `"`,
		`property='` + name + `'`,
		`name="og:` + name + `"`,
		`property="og:` + name + `"`,
	}

	for _, pattern := range patterns {
		idx := strings.Index(lower, pattern)
		if idx == -1 {
			continue
		}

		// Find the enclosing <meta tag
		tagStart := strings.LastIndex(lower[:idx], "<meta")
		if tagStart == -1 {
			continue
		}

		tagEnd := strings.Index(lower[tagStart:], ">")
		if tagEnd == -1 {
			continue
		}

		tag := html[tagStart : tagStart+tagEnd+1]
		tagLower := strings.ToLower(tag)

		// Extract content attribute
		contentIdx := strings.Index(tagLower, `content="`)
		if contentIdx != -1 {
			start := contentIdx + len(`content="`)
			end := strings.Index(tag[start:], `"`)
			if end != -1 {
				return strings.TrimSpace(tag[start : start+end])
			}
		}

		contentIdx = strings.Index(tagLower, `content='`)
		if contentIdx != -1 {
			start := contentIdx + len(`content='`)
			end := strings.Index(tag[start:], `'`)
			if end != -1 {
				return strings.TrimSpace(tag[start : start+end])
			}
		}
	}

	return ""
}

func extractTitle(html string) string {
	lower := strings.ToLower(html)
	startIdx := strings.Index(lower, "<title")
	if startIdx == -1 {
		return ""
	}
	// Find the closing > of the opening tag
	closeTag := strings.Index(lower[startIdx:], ">")
	if closeTag == -1 {
		return ""
	}
	contentStart := startIdx + closeTag + 1
	endIdx := strings.Index(lower[contentStart:], "</title>")
	if endIdx == -1 {
		return ""
	}
	return strings.TrimSpace(html[contentStart : contentStart+endIdx])
}

func main() {
	app := fiber.New()

	app.Post("/preview", func(c *fiber.Ctx) error {
		var req PreviewRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid or missing URL"})
		}

		if req.URL == "" {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		// Validate URL
		parsedURL, err := url.ParseRequestURI(req.URL)
		if err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		// Only allow http and https schemes
		if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		// Ensure host is present
		if parsedURL.Host == "" {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		// Fetch the URL with a timeout
		client := &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 10 {
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

		// Limit reading to 1MB to prevent abuse
		limitedReader := io.LimitReader(resp.Body, 1*1024*1024)
		body, err := io.ReadAll(limitedReader)
		if err != nil {
			return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
		}

		html := string(body)

		title := extractTitle(html)
		description := extractMetaContent(html, "description")

		// Also try og:description if description is empty
		if description == "" {
			description = extractMetaContent(html, "og:description")
		}

		// Try og:title if title is empty
		if title == "" {
			title = extractMetaContent(html, "og:title")
		}

		return c.Status(200).JSON(PreviewResponse{
			Title:       title,
			Description: description,
			StatusCode:  resp.StatusCode,
		})
	})

	app.Listen("0.0.0.0:5000")
}