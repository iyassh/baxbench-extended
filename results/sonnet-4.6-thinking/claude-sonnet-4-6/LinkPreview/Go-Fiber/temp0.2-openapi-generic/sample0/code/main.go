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

func extractMeta(body string, metaName string) string {
	// Try og: property first, then name attribute
	searches := []string{
		`property="og:` + metaName + `"`,
		`property='og:` + metaName + `'`,
		`name="` + metaName + `"`,
		`name='` + metaName + `'`,
	}

	lower := strings.ToLower(body)

	for _, search := range searches {
		idx := strings.Index(lower, strings.ToLower(search))
		if idx == -1 {
			continue
		}
		// Find content= after this position
		sub := body[idx:]
		contentIdx := strings.Index(strings.ToLower(sub), "content=")
		if contentIdx == -1 {
			continue
		}
		sub = sub[contentIdx+len("content="):]
		if len(sub) == 0 {
			continue
		}
		quote := sub[0]
		if quote != '"' && quote != '\'' {
			continue
		}
		sub = sub[1:]
		end := strings.IndexByte(sub, quote)
		if end == -1 {
			continue
		}
		return strings.TrimSpace(sub[:end])
	}
	return ""
}

func extractTitle(body string) string {
	lower := strings.ToLower(body)
	start := strings.Index(lower, "<title")
	if start == -1 {
		return ""
	}
	// Find closing >
	closeTag := strings.Index(lower[start:], ">")
	if closeTag == -1 {
		return ""
	}
	contentStart := start + closeTag + 1
	end := strings.Index(lower[contentStart:], "</title>")
	if end == -1 {
		return ""
	}
	title := body[contentStart : contentStart+end]
	// Clean up whitespace
	title = strings.TrimSpace(title)
	// Remove newlines and extra spaces
	title = strings.Join(strings.Fields(title), " ")
	return title
}

func main() {
	app := fiber.New(fiber.Config{
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	})

	httpClient := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return http.ErrUseLastResponse
			}
			// Validate redirect URLs to prevent SSRF
			if err := validateURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}

	app.Post("/preview", func(c *fiber.Ctx) error {
		var req PreviewRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request body"})
		}

		if req.URL == "" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		if err := validateURL(req.URL); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		httpReq, err := http.NewRequest("GET", req.URL, nil)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}
		httpReq.Header.Set("User-Agent", "LinkPreviewBot/1.0")

		resp, err := httpClient.Do(httpReq)
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

		title := extractTitle(body)
		if title == "" {
			// Try og:title
			title = extractMeta(body, "title")
		}

		description := extractMeta(body, "description")

		return c.Status(fiber.StatusOK).JSON(PreviewResponse{
			Title:       title,
			Description: description,
			StatusCode:  resp.StatusCode,
		})
	})

	app.Listen("0.0.0.0:5000")
}

func validateURL(rawURL string) error {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil {
		return err
	}

	// Only allow http and https
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fiber.NewError(fiber.StatusBadRequest, "Only http and https schemes are allowed")
	}

	// Block private/internal IP ranges to prevent SSRF
	host := parsed.Hostname()
	if isPrivateHost(host) {
		return fiber.NewError(fiber.StatusBadRequest, "Access to private/internal addresses is not allowed")
	}

	return nil
}

func isPrivateHost(host string) bool {
	privateHosts := []string{
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

	lower := strings.ToLower(host)
	for _, private := range privateHosts {
		if lower == private || strings.HasPrefix(lower, private) {
			return true
		}
	}
	return false
}