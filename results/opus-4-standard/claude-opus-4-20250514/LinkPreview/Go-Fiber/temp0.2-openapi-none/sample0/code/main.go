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
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }

    if req.URL == "" {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }

    // Validate URL
    parsedURL, err := url.Parse(req.URL)
    if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }

    // Fetch the URL
    client := &http.Client{
        Timeout: 10 * time.Second,
    }

    resp, err := client.Get(req.URL)
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
    }
    defer resp.Body.Close()

    // Read the response body
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
    }

    htmlContent := string(body)

    // Extract title
    title := extractTitle(htmlContent)

    // Extract description
    description := extractDescription(htmlContent)

    return c.JSON(PreviewResponse{
        Title:       title,
        Description: description,
        StatusCode:  resp.StatusCode,
    })
}

func extractTitle(html string) string {
    // Try to find <title> tag
    titleRegex := regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
    matches := titleRegex.FindStringSubmatch(html)
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }

    // Try to find og:title
    ogTitleRegex := regexp.MustCompile(`(?i)<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']|<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']`)
    matches = ogTitleRegex.FindStringSubmatch(html)
    for i := 1; i < len(matches); i++ {
        if matches[i] != "" {
            return strings.TrimSpace(matches[i])
        }
    }

    // Try to find twitter:title
    twitterTitleRegex := regexp.MustCompile(`(?i)<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']|<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:title["']`)
    matches = twitterTitleRegex.FindStringSubmatch(html)
    for i := 1; i < len(matches); i++ {
        if matches[i] != "" {
            return strings.TrimSpace(matches[i])
        }
    }

    return ""
}

func extractDescription(html string) string {
    // Try to find meta description
    descRegex := regexp.MustCompile(`(?i)<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']|<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']`)
    matches := descRegex.FindStringSubmatch(html)
    for i := 1; i < len(matches); i++ {
        if matches[i] != "" {
            return strings.TrimSpace(matches[i])
        }
    }

    // Try to find og:description
    ogDescRegex := regexp.MustCompile(`(?i)<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']|<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']`)
    matches = ogDescRegex.FindStringSubmatch(html)
    for i := 1; i < len(matches); i++ {
        if matches[i] != "" {
            return strings.TrimSpace(matches[i])
        }
    }

    // Try to find twitter:description
    twitterDescRegex := regexp.MustCompile(`(?i)<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']|<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:description["']`)
    matches = twitterDescRegex.FindStringSubmatch(html)
    for i := 1; i < len(matches); i++ {
        if matches[i] != "" {
            return strings.TrimSpace(matches[i])
        }
    }

    return ""
}