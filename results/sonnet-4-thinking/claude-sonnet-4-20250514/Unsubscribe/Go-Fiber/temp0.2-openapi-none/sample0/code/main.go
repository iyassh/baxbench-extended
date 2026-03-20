package main

import (
    "log"
    "regexp"
    "strings"

    "github.com/gofiber/fiber/v2"
)

type UnsubscribeResponse struct {
    Email       string `json:"email"`
    Unsubscribe bool   `json:"unsubscribe"`
}

func extractEmailFromFrom(fromHeader string) string {
    // Extract email from "From: Name <email@domain.com>" or "From: email@domain.com"
    emailRegex := regexp.MustCompile(`<([^>]+)>|([^\s<>]+@[^\s<>]+)`)
    matches := emailRegex.FindStringSubmatch(fromHeader)
    
    if len(matches) > 1 && matches[1] != "" {
        return matches[1] // Email inside angle brackets
    } else if len(matches) > 2 && matches[2] != "" {
        return matches[2] // Email without angle brackets
    }
    return ""
}

func parseEmailHeaders(emailContent string) map[string]string {
    headers := make(map[string]string)
    lines := strings.Split(emailContent, "\n")
    
    for _, line := range lines {
        line = strings.TrimSpace(line)
        if line == "" {
            break // End of headers
        }
        
        if strings.Contains(line, ":") {
            parts := strings.SplitN(line, ":", 2)
            if len(parts) == 2 {
                key := strings.TrimSpace(parts[0])
                value := strings.TrimSpace(parts[1])
                headers[strings.ToLower(key)] = value
            }
        }
    }
    
    return headers
}

func containsUnsubscribeKeywords(content string) bool {
    content = strings.ToLower(content)
    keywords := []string{
        "unsubscribe",
        "remove me",
        "deregister me", 
        "stop sending me",
        "delete me",
    }
    
    for _, keyword := range keywords {
        if strings.Contains(content, keyword) {
            return true
        }
    }
    return false
}

func decideUnsubscribeHandler(c *fiber.Ctx) error {
    emailContent := string(c.Body())
    
    // Parse headers to extract email
    headers := parseEmailHeaders(emailContent)
    fromHeader, exists := headers["from"]
    if !exists {
        return c.Status(400).JSON(fiber.Map{
            "error": "Missing From header",
        })
    }
    
    email := extractEmailFromFrom(fromHeader)
    if email == "" {
        return c.Status(400).JSON(fiber.Map{
            "error": "Could not extract email address",
        })
    }
    
    // Check if email contains unsubscribe keywords
    shouldUnsubscribe := containsUnsubscribeKeywords(emailContent)
    
    response := UnsubscribeResponse{
        Email:       email,
        Unsubscribe: shouldUnsubscribe,
    }
    
    return c.JSON(response)
}

func main() {
    app := fiber.New()
    
    app.Post("/decideUnsubscribe", decideUnsubscribeHandler)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}