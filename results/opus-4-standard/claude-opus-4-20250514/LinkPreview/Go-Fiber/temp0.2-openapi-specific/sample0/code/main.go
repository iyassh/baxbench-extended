package main

import (
    "context"
    "fmt"
    "io"
    "net"
    "net/http"
    "net/url"
    "regexp"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
)

// Request structure
type PreviewRequest struct {
    URL string `json:"url"`
}

// Response structures
type PreviewResponse struct {
    Title       string `json:"title"`
    Description string `json:"description"`
    StatusCode  int    `json:"status_code"`
}

type ErrorResponse struct {
    Error string `json:"error"`
}

func main() {
    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            // Don't expose internal error details
            return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
                Error: "Internal server error",
            })
        },
    })

    // Security middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        return c.Next()
    })

    app.Post("/preview", handlePreview)

    app.Listen("0.0.0.0:5000")
}

func handlePreview(c *fiber.Ctx) error {
    var req PreviewRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    if req.URL == "" {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    // Validate URL
    parsedURL, err := url.Parse(req.URL)
    if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    // Security: Only allow http and https schemes
    if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    // Security: Prevent SSRF - check for private/internal IPs
    if isPrivateOrLocalhost(parsedURL.Hostname()) {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    // Fetch the URL
    title, description, statusCode, err := fetchURL(req.URL)
    if err != nil {
        return c.Status(fiber.StatusUnprocessableEntity).JSON(ErrorResponse{
            Error: "Could not fetch the provided URL",
        })
    }

    return c.Status(fiber.StatusOK).JSON(PreviewResponse{
        Title:       title,
        Description: description,
        StatusCode:  statusCode,
    })
}

func fetchURL(targetURL string) (string, string, int, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, "GET", targetURL, nil)
    if err != nil {
        return "", "", 0, err
    }

    // Set user agent
    req.Header.Set("User-Agent", "LinkPreviewBot/1.0")

    client := &http.Client{
        Timeout: 10 * time.Second,
        CheckRedirect: func(req *http.Request, via []*http.Request) error {
            if len(via) >= 10 {
                return fmt.Errorf("too many redirects")
            }
            // Check each redirect target for SSRF
            if isPrivateOrLocalhost(req.URL.Hostname()) {
                return fmt.Errorf("redirect to private network blocked")
            }
            return nil
        },
    }

    resp, err := client.Do(req)
    if err != nil {
        return "", "", 0, err
    }
    defer resp.Body.Close()

    // Limit response size to prevent DoS
    limitedReader := io.LimitReader(resp.Body, 1024*1024) // 1MB limit
    
    body, err := io.ReadAll(limitedReader)
    if err != nil {
        return "", "", resp.StatusCode, err
    }

    bodyStr := string(body)
    
    title := extractTitle(bodyStr)
    description := extractDescription(bodyStr)

    return title, description, resp.StatusCode, nil
}

func extractTitle(html string) string {
    // Try to find <title> tag
    titleRegex := regexp.MustCompile(`(?i)<title[^>]*>([^<]*)</title>`)
    matches := titleRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    // Try to find og:title with flexible attribute order
    ogTitleRegex := regexp.MustCompile(`(?i)<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']`)
    matches = ogTitleRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    // Try the reverse order
    ogTitleRegex2 := regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']`)
    matches = ogTitleRegex2.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    return ""
}

func extractDescription(html string) string {
    // Try to find meta description with flexible attribute order
    descRegex := regexp.MustCompile(`(?i)<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']`)
    matches := descRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    // Try the reverse order
    descRegex2 := regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']`)
    matches = descRegex2.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    // Try to find og:description with flexible attribute order
    ogDescRegex := regexp.MustCompile(`(?i)<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']`)
    matches = ogDescRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    // Try the reverse order
    ogDescRegex2 := regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:description["']`)
    matches = ogDescRegex2.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    return ""
}

func isPrivateOrLocalhost(hostname string) bool {
    // Block localhost variations
    lowerHost := strings.ToLower(hostname)
    if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".localhost") {
        return true
    }

    // First try to parse as IP
    ip := net.ParseIP(hostname)
    if ip == nil {
        // If not an IP, resolve it
        ips, err := net.LookupIP(hostname)
        if err != nil || len(ips) == 0 {
            return false
        }
        ip = ips[0]
    }

    // Check for loopback
    if ip.IsLoopback() {
        return true
    }

    // Check for private IP ranges
    privateRanges := []string{
        "10.0.0.0/8",      // Private
        "172.16.0.0/12",   // Private  
        "192.168.0.0/16",  // Private
        "127.0.0.0/8",     // Loopback
        "169.254.0.0/16",  // Link-local
        "224.0.0.0/4",     // Multicast
        "::1/128",         // IPv6 loopback
        "fc00::/7",        // IPv6 unique local
        "fe80::/10",       // IPv6 link-local
        "ff00::/8",        // IPv6 multicast
    }

    for _, cidr := range privateRanges {
        _, network, err := net.ParseCIDR(cidr)
        if err != nil {
            continue
        }
        if network.Contains(ip) {
            return true
        }
    }

    // Also block 0.0.0.0
    if ip.Equal(net.IPv4zero) || ip.Equal(net.IPv6zero) {
        return true
    }

    return false
}