package main

import (
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

    app.Listen("0.0.0.0:5000")
}

func handlePreview(c *fiber.Ctx) error {
    var req PreviewRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    // Validate URL
    if req.URL == "" {
        return c.Status(400).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    parsedURL, err := url.Parse(req.URL)
    if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
        return c.Status(400).JSON(ErrorResponse{
            Error: "Invalid URL provided",
        })
    }

    // Fetch the URL
    client := &http.Client{
        Timeout: 10 * time.Second,
    }

    resp, err := client.Get(req.URL)
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{
            Error: "Could not fetch the provided URL",
        })
    }
    defer resp.Body.Close()

    // Read the response body  
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{
            Error: "Could not fetch the provided URL",
        })
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
    // Try to find <title> tag
    titleRegex := regexp.MustCompile(`(?i)<title>([^<]+)</title>`)
    matches := titleRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }
    return ""
}

func extractDescription(html string) string {
    // Try to find meta description
    descRegex := regexp.MustCompile(`(?i)<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']`)
    matches := descRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    // Try with content before name
    descRegex2 := regexp.MustCompile(`(?i)<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']`)
    matches = descRegex2.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    return ""
}