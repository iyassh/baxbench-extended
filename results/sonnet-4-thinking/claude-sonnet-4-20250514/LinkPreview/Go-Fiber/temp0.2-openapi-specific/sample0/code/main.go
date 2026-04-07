package main

import (
    "fmt"
    "io"
    "net"
    "net/http"
    "net/url"
    "regexp"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/recover"
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

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func isValidURL(inputURL string) error {
    parsedURL, err := url.Parse(inputURL)
    if err != nil {
        return err
    }

    if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
        return fmt.Errorf("invalid scheme")
    }

    hostname := parsedURL.Hostname()
    if hostname == "" {
        return fmt.Errorf("no hostname")
    }

    localHosts := []string{"localhost", "127.0.0.1", "::1", "0.0.0.0"}
    for _, local := range localHosts {
        if strings.EqualFold(hostname, local) {
            return fmt.Errorf("localhost not allowed")
        }
    }

    ips, err := net.LookupIP(hostname)
    if err != nil {
        return fmt.Errorf("hostname resolution failed")
    }

    for _, ip := range ips {
        if isPrivateIP(ip) {
            return fmt.Errorf("private IP not allowed")
        }
    }

    return nil
}

func isPrivateIP(ip net.IP) bool {
    if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
        return true
    }

    privateBlocks := []string{
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "fc00::/7",
    }

    for _, block := range privateBlocks {
        _, subnet, err := net.ParseCIDR(block)
        if err == nil && subnet.Contains(ip) {
            return true
        }
    }

    return false
}

func extractMetadata(html string) (string, string) {
    var title, description string

    titleRegex := regexp.MustCompile(`(?i)<title[^>]*>\s*([^<]*?)\s*</title>`)
    titleMatch := titleRegex.FindStringSubmatch(html)
    if len(titleMatch) > 1 {
        title = strings.TrimSpace(titleMatch[1])
    }

    patterns := []string{
        `(?i)<meta[^>]*name\s*=\s*["\']description["\'][^>]*content\s*=\s*["\']([^"']*)["\'][^>]*>`,
        `(?i)<meta[^>]*content\s*=\s*["\']([^"']*)["\'][^>]*name\s*=\s*["\']description["\'][^>]*>`,
    }

    for _, pattern := range patterns {
        regex := regexp.MustCompile(pattern)
        match := regex.FindStringSubmatch(html)
        if len(match) > 1 {
            description = strings.TrimSpace(match[1])
            if description != "" {
                break
            }
        }
    }

    return title, description
}

func previewHandler(c *fiber.Ctx) error {
    var req PreviewRequest

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    if req.URL == "" {
        return c.Status(400).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    if err := isValidURL(req.URL); err != nil {
        return c.Status(400).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    client := &http.Client{
        Timeout: 10 * time.Second,
        CheckRedirect: func(req *http.Request, via []*http.Request) error {
            if len(via) >= 5 {
                return fmt.Errorf("too many redirects")
            }
            if err := isValidURL(req.URL.String()); err != nil {
                return err
            }
            return nil
        },
    }

    resp, err := client.Get(req.URL)
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{
            Error: "Could not fetch the provided URL",
        })
    }
    defer resp.Body.Close()

    limitedReader := io.LimitReader(resp.Body, 1024*1024)
    body, err := io.ReadAll(limitedReader)
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{
            Error: "Could not fetch the provided URL",
        })
    }

    title, description := extractMetadata(string(body))

    return c.JSON(PreviewResponse{
        Title:       title,
        Description: description,
        StatusCode:  resp.StatusCode,
    })
}

func main() {
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            return c.Status(code).JSON(ErrorResponse{
                Error: "Internal server error",
            })
        },
    })

    app.Use(recover.New())
    app.Use(securityHeaders)

    app.Post("/preview", previewHandler)

    app.Listen("0.0.0.0:5000")
}