package main

import (
	"fmt"
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

func extractMeta(body string, property string) string {
	// Try og:property first
	ogTag := fmt.Sprintf(`property="og:%s"`, property)
	nameTag := fmt.Sprintf(`name="%s"`, property)

	for _, tag := range []string{ogTag, nameTag} {
		idx := strings.Index(strings.ToLower(body), strings.ToLower(tag))
		if idx == -1 {
			continue
		}
		// Find content= after the tag
		sub := body[idx:]
		contentIdx := strings.Index(strings.ToLower(sub), `content="`)
		if contentIdx == -1 {
			continue
		}
		sub = sub[contentIdx+9:]
		endIdx := strings.Index(sub, `"`)
		if endIdx == -1 {
			continue
		}
		return sub[:endIdx]
	}
	return ""
}

func extractTitle(body string) string {
	lower := strings.ToLower(body)
	start := strings.Index(lower, "<title>")
	if start == -1 {
		return ""
	}
	start += 7
	end := strings.Index(lower[start:], "</title>")
	if end == -1 {
		return ""
	}
	return strings.TrimSpace(body[start : start+end])
}

func previewHandler(c *fiber.Ctx) error {
	var req PreviewRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request body"})
	}

	if req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Validate URL
	parsedURL, err := url.ParseRequestURI(req.URL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	// Prevent SSRF by blocking private/internal addresses
	host := parsedURL.Hostname()
	if isPrivateHost(host) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			// Check redirect targets too
			if isPrivateHost(req.URL.Hostname()) {
				return fmt.Errorf("redirect to private address blocked")
			}
			return nil
		},
	}

	httpReq, err := http.NewRequest("GET", req.URL, nil)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	httpReq.Header.Set("User-Agent", "LinkPreviewBot/1.0")

	resp, err := client.Do(httpReq)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}
	defer resp.Body.Close()

	// Limit body read to 1MB
	limitedReader := io.LimitReader(resp.Body, 1*1024*1024)
	bodyBytes, err := io.ReadAll(limitedReader)
	if err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
	}

	body := string(bodyBytes)

	title := extractMeta(body, "title")
	if title == "" {
		title = extractTitle(body)
	}

	description := extractMeta(body, "description")

	return c.Status(fiber.StatusOK).JSON(PreviewResponse{
		Title:       title,
		Description: description,
		StatusCode:  resp.StatusCode,
	})
}

func isPrivateHost(host string) bool {
	privatePatterns := []string{
		"localhost",
		"127.",
		"10.",
		"192.168.",
		"172.16.",
		"172.17.",
		"172.18.",
		"172.19.",
		"172.20.",
		"172.21.",
		"172.22.",
		"172.23.",
		"172.24.",
		"172.25.",
		"172.26.",
		"172.27.",
		"172.28.",
		"172.29.",
		"172.30.",
		"172.31.",
		"::1",
		"0.0.0.0",
		"169.254.",
	}
	lowerHost := strings.ToLower(host)
	for _, pattern := range privatePatterns {
		if strings.HasPrefix(lowerHost, pattern) || lowerHost == strings.TrimSuffix(pattern, ".") {
			return true
		}
	}
	return false
}

func main() {
	app := fiber.New()

	app.Post("/preview", previewHandler)

	app.Listen("0.0.0.0:5000")
}