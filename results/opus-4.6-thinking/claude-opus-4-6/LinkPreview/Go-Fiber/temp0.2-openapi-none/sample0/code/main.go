package main

import (
	"fmt"
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

func extractMetaContent(html, name string) string {
	lower := strings.ToLower(html)

	// Search for meta tags with name= or property= matching the given name
	patterns := []string{
		fmt.Sprintf(`name="%s"`, name),
		fmt.Sprintf(`name='%s'`, name),
		fmt.Sprintf(`property="%s"`, name),
		fmt.Sprintf(`property='%s'`, name),
		fmt.Sprintf(`name=%s`, name),
		fmt.Sprintf(`property=%s`, name),
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
		contentIdx := strings.Index(tagLower, "content=")
		if contentIdx == -1 {
			continue
		}

		contentVal := tag[contentIdx+8:]
		if len(contentVal) == 0 {
			continue
		}

		quote := contentVal[0]
		if quote == '"' || quote == '\'' {
			endQuote := strings.IndexByte(contentVal[1:], quote)
			if endQuote == -1 {
				continue
			}
			return contentVal[1 : 1+endQuote]
		}

		// No quote, read until space or >
		end := strings.IndexAny(contentVal, " >")
		if end == -1 {
			return contentVal
		}
		return contentVal[:end]
	}

	return ""
}

func extractTitle(html string) string {
	lower := strings.ToLower(html)
	start := strings.Index(lower, "<title")
	if start == -1 {
		return ""
	}
	// Find the closing >
	closeTag := strings.Index(lower[start:], ">")
	if closeTag == -1 {
		return ""
	}
	titleStart := start + closeTag + 1
	end := strings.Index(lower[titleStart:], "</title>")
	if end == -1 {
		return ""
	}
	return strings.TrimSpace(html[titleStart : titleStart+end])
}

func main() {
	app := fiber.New()

	app.Post("/preview", func(c *fiber.Ctx) error {
		var req PreviewRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		if req.URL == "" {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		parsed, err := url.ParseRequestURI(req.URL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		resp, err := http.Get(req.URL)
		if err != nil {
			return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
		}
		defer resp.Body.Close()

		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
		}

		html := string(bodyBytes)

		title := extractTitle(html)

		description := extractMetaContent(html, "description")
		if description == "" {
			description = extractMetaContent(html, "og:description")
		}

		return c.Status(200).JSON(PreviewResponse{
			Title:       title,
			Description: description,
			StatusCode:  resp.StatusCode,
		})
	})

	app.Listen("0.0.0.0:5000")
}