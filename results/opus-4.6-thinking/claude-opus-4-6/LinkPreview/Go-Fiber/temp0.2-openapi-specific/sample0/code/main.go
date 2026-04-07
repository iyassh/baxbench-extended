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

func isPrivateIP(ip net.IP) bool {
	privateRanges := []struct {
		network *net.IPNet
	}{
		{parseCIDR("10.0.0.0/8")},
		{parseCIDR("172.16.0.0/12")},
		{parseCIDR("192.168.0.0/16")},
		{parseCIDR("127.0.0.0/8")},
		{parseCIDR("169.254.0.0/16")},
		{parseCIDR("::1/128")},
		{parseCIDR("fc00::/7")},
		{parseCIDR("fe80::/10")},
		{parseCIDR("0.0.0.0/8")},
	}

	for _, r := range privateRanges {
		if r.network.Contains(ip) {
			return true
		}
	}
	return false
}

func parseCIDR(cidr string) *net.IPNet {
	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		panic(err)
	}
	return network
}

func isURLSafe(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("only http and https schemes are allowed")
	}

	hostname := parsed.Hostname()
	if hostname == "" {
		return fmt.Errorf("missing hostname")
	}

	ips, err := net.LookupIP(hostname)
	if err != nil {
		return fmt.Errorf("could not resolve hostname")
	}

	for _, ip := range ips {
		if isPrivateIP(ip) {
			return fmt.Errorf("access to private/internal addresses is not allowed")
		}
	}

	return nil
}

func extractMetadata(body io.Reader) (title string, description string) {
	tokenizer := html.NewTokenizer(body)
	inTitle := false

	for {
		tt := tokenizer.Next()
		switch tt {
		case html.ErrorToken:
			return title, description
		case html.StartTagToken, html.SelfClosingTagToken:
			tn, hasAttr := tokenizer.TagName()
			tagName := string(tn)

			if tagName == "title" && tt == html.StartTagToken {
				inTitle = true
			}

			if tagName == "meta" && hasAttr {
				var nameVal, contentVal string
				for {
					key, val, more := tokenizer.TagAttr()
					k := strings.ToLower(string(key))
					v := string(val)
					if k == "name" || k == "property" {
						nameVal = strings.ToLower(v)
					}
					if k == "content" {
						contentVal = v
					}
					if !more {
						break
					}
				}
				if (nameVal == "description" || nameVal == "og:description") && description == "" {
					description = contentVal
				}
				if nameVal == "og:title" && title == "" {
					title = contentVal
				}
			}
		case html.TextToken:
			if inTitle && title == "" {
				title = strings.TrimSpace(tokenizer.Token().Data)
			}
		case html.EndTagToken:
			tn, _ := tokenizer.TagName()
			if string(tn) == "title" {
				inTitle = false
			}
		}
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func main() {
	app := fiber.New(fiber.Config{
		DisableStartupMessage: false,
	})

	app.Use(securityHeaders)

	app.Post("/preview", func(c *fiber.Ctx) error {
		var req PreviewRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid request body"})
		}

		if req.URL == "" {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		parsed, err := url.Parse(req.URL)
		if err != nil || parsed.Host == "" {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		scheme := strings.ToLower(parsed.Scheme)
		if scheme != "http" && scheme != "https" {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		if err := isURLSafe(req.URL); err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
		}

		client := &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return fmt.Errorf("too many redirects")
				}
				// Check each redirect destination for SSRF
				redirectHost := req.URL.Hostname()
				ips, err := net.LookupIP(redirectHost)
				if err != nil {
					return fmt.Errorf("could not resolve redirect hostname")
				}
				for _, ip := range ips {
					if isPrivateIP(ip) {
						return fmt.Errorf("redirect to private address blocked")
					}
				}
				rScheme := strings.ToLower(req.URL.Scheme)
				if rScheme != "http" && rScheme != "https" {
					return fmt.Errorf("invalid redirect scheme")
				}
				return nil
			},
		}

		httpReq, err := http.NewRequest("GET", req.URL, nil)
		if err != nil {
			return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
		}
		httpReq.Header.Set("User-Agent", "LinkPreviewBot/1.0")

		resp, err := client.Do(httpReq)
		if err != nil {
			return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
		}
		defer resp.Body.Close()

		// Limit the body read to 5MB to prevent resource exhaustion
		limitedReader := io.LimitReader(resp.Body, 5*1024*1024)

		title, description := extractMetadata(limitedReader)

		return c.Status(200).JSON(PreviewResponse{
			Title:       title,
			Description: description,
			StatusCode:  resp.StatusCode,
		})
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}