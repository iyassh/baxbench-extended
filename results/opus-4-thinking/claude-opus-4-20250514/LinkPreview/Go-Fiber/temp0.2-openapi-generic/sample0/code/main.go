package main

import (
    "fmt"
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

func main() {
    app := fiber.New()

    app.Post("/preview", handlePreview)

    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}

func handlePreview(c *fiber.Ctx) error {
    var req PreviewRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }

    // Validate URL
    if req.URL == "" {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }

    parsedURL, err := url.Parse(req.URL)
    if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }

    // Fetch the URL
    client := &http.Client{
        Timeout: 10 * time.Second,
        CheckRedirect: func(req *http.Request, via []*http.Request) error {
            if len(via) >= 10 {
                return fmt.Errorf("too many redirects")
            }
            return nil
        },
    }

    resp, err := client.Get(req.URL)
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
    }
    defer resp.Body.Close()

    // Read the response body with a limit to prevent memory exhaustion
    body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024)) // 1MB limit
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
    }

    // Extract title and description
    title := extractTitle(string(body))
    description := extractDescription(string(body))

    return c.JSON(PreviewResponse{
        Title:       title,
        Description: description,
        StatusCode:  resp.StatusCode,
    })
}

func extractTitle(html string) string {
    titleRegex := regexp.MustCompile(`(?i)<title[^>]*>([^<]*)</title>`)
    matches := titleRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }
    return ""
}

func extractDescription(html string) string {
    // Match meta description tags in various formats
    patterns := []string{
        `<meta\s+name\s*=\s*"description"\s+content\s*=\s*"([^"]*)"`,
        `<meta\s+name\s*=\s*'description'\s+content\s*=\s*'([^']*)'`,
        `<meta\s+content\s*=\s*"([^"]*)"\s+name\s*=\s*"description"`,
        `<meta\s+content\s*=\s*'([^']*)'\s+name\s*=\s*'description'`,
    }
    
    for _, pattern := range patterns {
        descRegex := regexp.MustCompile(`(?i)` + pattern)
        matches := descRegex.FindStringSubmatch(html)
        if len(matches) > 1 {
            return strings.TrimSpace(matches[1])
        }
    }
    
    return ""
}