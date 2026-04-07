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

    // Validate URL
    if req.URL == "" {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }

    parsedURL, err := url.Parse(req.URL)
    if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid URL provided"})
    }

    // Only allow http and https
    if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
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

    // Read the body
    body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024)) // Limit to 1MB
    if err != nil {
        return c.Status(422).JSON(ErrorResponse{Error: "Could not fetch the provided URL"})
    }

    // Extract metadata
    title := extractTitle(string(body))
    description := extractDescription(string(body))

    return c.Status(200).JSON(PreviewResponse{
        Title:       title,
        Description: description,
        StatusCode:  resp.StatusCode,
    })
}

func extractTitle(html string) string {
    // Find <title> tag
    startIdx := strings.Index(strings.ToLower(html), "<title")
    if startIdx == -1 {
        return ""
    }

    // Find the closing >
    closeIdx := strings.Index(html[startIdx:], ">")
    if closeIdx == -1 {
        return ""
    }

    // Find </title>
    endIdx := strings.Index(strings.ToLower(html[startIdx:]), "</title>")
    if endIdx == -1 {
        return ""
    }

    // Extract the content
    titleStart := startIdx + closeIdx + 1
    titleEnd := startIdx + endIdx
    if titleEnd <= titleStart {
        return ""
    }

    title := html[titleStart:titleEnd]
    // Clean up whitespace
    title = strings.TrimSpace(title)
    title = strings.ReplaceAll(title, "\n", " ")
    title = strings.ReplaceAll(title, "\r", " ")
    title = strings.ReplaceAll(title, "\t", " ")
    // Collapse multiple spaces
    for strings.Contains(title, "  ") {
        title = strings.ReplaceAll(title, "  ", " ")
    }

    return title
}

func extractDescription(html string) string {
    // Find <meta name="description" or <meta property="og:description"
    lowerHtml := strings.ToLower(html)
    
    // Try to find meta description
    metaIdx := -1
    
    // Check for standard meta description
    metaIdx = strings.Index(lowerHtml, `<meta name="description"`)
    if metaIdx == -1 {
        metaIdx = strings.Index(lowerHtml, `<meta name='description'`)
    }
    
    // If not found, try Open Graph
    if metaIdx == -1 {
        metaIdx = strings.Index(lowerHtml, `<meta property="og:description"`)
    }
    if metaIdx == -1 {
        metaIdx = strings.Index(lowerHtml, `<meta property='og:description'`)
    }
    
    if metaIdx == -1 {
        return ""
    }
    
    // Find the end of the meta tag
    metaEndIdx := strings.Index(html[metaIdx:], ">")
    if metaEndIdx == -1 {
        return ""
    }
    
    metaTag := html[metaIdx : metaIdx+metaEndIdx+1]
    
    // Extract content attribute
    contentIdx := strings.Index(strings.ToLower(metaTag), "content=")
    if contentIdx == -1 {
        return ""
    }
    
    // Find the quote character
    contentStart := contentIdx + 8 // len("content=")
    if contentStart >= len(metaTag) {
        return ""
    }
    
    quote := metaTag[contentStart]
    if quote != '"' && quote != '\'' {
        return ""
    }
    
    // Find the closing quote
    valueStart := contentStart + 1
    valueEnd := strings.Index(metaTag[valueStart:], string(quote))
    if valueEnd == -1 {
        return ""
    }
    
    description := metaTag[valueStart : valueStart+valueEnd]
    return strings.TrimSpace(description)
}