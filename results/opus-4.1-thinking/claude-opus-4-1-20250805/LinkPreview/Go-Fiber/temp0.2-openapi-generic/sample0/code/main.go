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

var (
    titleRegex = regexp.MustCompile(`(?i)<title[^>]*>([^<]*)</title>`)
    descRegex1 = regexp.MustCompile(`(?i)<meta\s+(?:[^>]*?\s+)?(?:name|property)=["'](?:description|og:description)["'][^>]*?\s+content=["']([^"']+)["']`)
    descRegex2 = regexp.MustCompile(`(?i)<meta\s+(?:[^>]*?\s+)?content=["']([^"']+)["'][^>]*?\s+(?:name|property)=["'](?:description|og:description)["']`)
)

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
    
    if req.URL == "" {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }
    
    // Validate URL
    parsedURL, err := url.Parse(req.URL)
    if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }
    
    // Only allow HTTP and HTTPS
    if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
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
    
    // Limit response size to 1MB
    limitedReader := io.LimitReader(resp.Body, 1024*1024)
    body, err := io.ReadAll(limitedReader)
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
    }
    
    // Extract metadata
    htmlContent := string(body)
    title := extractTitle(htmlContent)
    description := extractDescription(htmlContent)
    
    return c.JSON(PreviewResponse{
        Title:       title,
        Description: description,
        StatusCode:  resp.StatusCode,
    })
}

func extractTitle(html string) string {
    matches := titleRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }
    return ""
}

func extractDescription(html string) string {
    // Try first pattern
    matches := descRegex1.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }
    
    // Try second pattern
    matches = descRegex2.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }
    
    return ""
}