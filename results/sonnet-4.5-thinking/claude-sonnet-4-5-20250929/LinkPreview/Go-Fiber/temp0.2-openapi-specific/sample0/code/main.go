package main

import (
	"context"
	"fmt"
	"html"
	"io"
	"net"
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

func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	return false
}

func validateURL(urlStr string) error {
	if urlStr == "" {
		return fmt.Errorf("URL is required")
	}

	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return fmt.Errorf("invalid URL format")
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("invalid URL scheme")
	}

	hostname := parsedURL.Hostname()
	if hostname == "" {
		return fmt.Errorf("invalid URL hostname")
	}

	ips, err := net.LookupIP(hostname)
	if err != nil {
		return fmt.Errorf("invalid URL hostname")
	}

	for _, ip := range ips {
		if isPrivateIP(ip) {
			return fmt.Errorf("invalid URL")
		}
	}

	return nil
}

func extractMetadata(htmlContent string) (string, string) {
	title := ""
	description := ""

	titleRegex := regexp.MustCompile(`(?i)<title[^>]*>([^<]*)</title>`)
	titleMatches := titleRegex.FindStringSubmatch(htmlContent)
	if len(titleMatches) > 1 {
		title = html.UnescapeString(strings.TrimSpace(titleMatches[1]))
	}

	patterns := []string{
		`(?i)<meta[^>]+name="description"[^>]+content="([^"]*)"`,
		`(?i)<meta[^>]+name='description'[^>]+content='([^']*)'`,
		`(?i)<meta[^>]+content="([^"]*)"\s+name="description"`,
		`(?i)<meta[^>]+content='([^']*)'\s+name='description'`,
		`(?i)<meta[^>]+property="og:description"[^>]+content="([^"]*)"`,
		`(?i)<meta[^>]+property='og:description'[^>]+content='([^']*)'`,
		`(?i)<meta[^>]+content="([^"]*)"\s+property="og:description"`,
		`(?i)<meta[^>]+content='([^']*)'\s+property='og:description'`,
	}

	for _, pattern := range patterns {
		regex := regexp.MustCompile(pattern)
		matches := regex.FindStringSubmatch(htmlContent)
		if len(matches) > 1 {
			description = html.UnescapeString(strings.TrimSpace(matches[1]))
			break
		}
	}

	return title, description
}

func fetchURL(urlStr string) (string, int, error) {
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, _, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}

				ips, err := net.LookupIP(host)
				if err != nil {
					return nil, err
				}

				for _, ip := range ips {
					if isPrivateIP(ip) {
						return nil, fmt.Errorf("private IP address")
					}
				}

				dialer := &net.Dialer{
					Timeout: 5 * time.Second,
				}
				return dialer.DialContext(ctx, network, addr)
			},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			if err := validateURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}

	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return "", 0, err
	}

	req.Header.Set("User-Agent", "LinkPreviewBot/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	limitedReader := io.LimitReader(resp.Body, 10*1024*1024)
	body, err := io.ReadAll(limitedReader)
	if err != nil {
		return "", resp.StatusCode, err
	}

	return string(body), resp.StatusCode, nil
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "An error occurred",
			})
		},
	})

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

		if err := validateURL(req.URL); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid URL provided",
			})
		}

		htmlContent, statusCode, err := fetchURL(req.URL)
		if err != nil {
			return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{
				Error: "Could not fetch the provided URL",
			})
		}

		title, description := extractMetadata(htmlContent)

		return c.Status(fiber.StatusOK).JSON(PreviewResponse{
			Title:       title,
			Description: description,
			StatusCode:  statusCode,
		})
	})

	app.Listen("0.0.0.0:5000")
}