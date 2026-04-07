package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/net/html"
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

func isAllowedURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}

	// Only allow http and https schemes
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}

	hostname := parsed.Hostname()
	if hostname == "" {
		return false
	}

	// Block localhost and common loopback names
	lowerHost := strings.ToLower(hostname)
	if lowerHost == "localhost" || lowerHost == "127.0.0.1" || lowerHost == "::1" ||
		lowerHost == "0.0.0.0" || lowerHost == "[::1]" {
		return false
	}

	// Resolve the hostname and check for private/reserved IPs
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return false
	}

	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
			ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return false
		}
		// Block 169.254.x.x (link-local) and 100.64.0.0/10 (CGN)
		if ip4 := ip.To4(); ip4 != nil {
			if ip4[0] == 169 && ip4[1] == 254 {
				return false
			}
			// Block 100.64.0.0/10
			if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
				return false
			}
			// Block 0.0.0.0/8
			if ip4[0] == 0 {
				return false
			}
		}
	}

	return true
}

func extractMetadata(body io.Reader) (title string, description string) {
	tokenizer := html.NewTokenizer(body)
	inTitle := false
	titleFound := false
	descFound := false

	for {
		tt := tokenizer.Next()
		switch tt {
		case html.ErrorToken:
			return title, description
		case html.StartTagToken, html.SelfClosingTagToken:
			tn, hasAttr := tokenizer.TagName()
			tagName := string(tn)

			if tagName == "title" && !titleFound {
				inTitle = true
			}

			if tagName == "meta" && hasAttr {
				var nameVal, contentVal string
				for {
					key, val, more := tokenizer.TagAttr()
					k := strings.ToLower(string(key))
					if k == "name" || k == "property" {
						nameVal = strings.ToLower(string(val))
					}
					if k == "content" {
						contentVal = string(val)
					}
					if !more {
						break
					}
				}
				if !descFound && (nameVal == "description" || nameVal == "og:description") {
					description = contentVal
					descFound = true
				}
				if !titleFound && nameVal == "og:title" {
					title = contentVal
					titleFound = true
				}
			}
		case html.TextToken:
			if inTitle {
				title = strings.TrimSpace(string(tokenizer.Text()))
				titleFound = true
				inTitle = false
			}
		case html.EndTagToken:
			tn, _ := tokenizer.TagName()
			if string(tn) == "title" {
				inTitle = false
			}
		}

		if titleFound && descFound {
			return title, description
		}
	}
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable detailed error messages in responses
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{Error: "An error occurred"})
		},
		DisableStartupMessage: false,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/preview", func(c *fiber.Ctx) error {
		var req PreviewRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid request body",
			})
		}

		if req.URL == "" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid URL provided",
			})
		}

		// Validate URL format
		parsed, err := url.Parse(req.URL)
		if err != nil || parsed.Host == "" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid URL provided",
			})
		}

		scheme := strings.ToLower(parsed.Scheme)
		if scheme != "http" && scheme != "https" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid URL provided",
			})
		}

		// SSRF protection: check if URL points to internal/private addresses
		if !isAllowedURL(req.URL) {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid URL provided",
			})
		}

		// Create HTTP client with timeout and no redirect following to internal addresses
		client := &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("too many redirects")
				}
				// Check redirect target for SSRF
				redirectURL := req.URL.String()
				if !isAllowedURL(redirectURL) {
					return fmt.Errorf("redirect to disallowed URL")
				}
				return nil
			},
		}

		httpReq, err := http.NewRequest("GET", req.URL, nil)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid URL provided",
			})
		}

		httpReq.Header.Set("User-Agent", "LinkPreviewBot/1.0")
		httpReq.Header.Set("Accept", "text/html")

		resp, err := client.Do(httpReq)
		if err != nil {
			return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{
				Error: "Could not fetch the provided URL",
			})
		}
		defer resp.Body.Close()

		// Limit the amount of data we read to prevent resource exhaustion
		limitedReader := io.LimitReader(resp.Body, 1*1024*1024) // 1MB max

		title, description := extractMetadata(limitedReader)

		return c.Status(fiber.StatusOK).JSON(PreviewResponse{
			Title:       title,
			Description: description,
			StatusCode:  resp.StatusCode,
		})
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}