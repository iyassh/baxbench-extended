package main

import (
    "github.com/gofiber/fiber/v2"
    "strings"
)

type UnsubscribeResponse struct {
    Email       string `json:"email"`
    Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
    app := fiber.New()

    app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
        // Get raw email content
        rawEmail := string(c.Body())
        
        // Extract email address from From header
        email := extractEmailFromHeader(rawEmail)
        
        // Check if email contains unsubscribe keywords
        unsubscribe := containsUnsubscribeKeywords(rawEmail)
        
        response := UnsubscribeResponse{
            Email:       email,
            Unsubscribe: unsubscribe,
        }
        
        return c.JSON(response)
    })

    app.Listen("0.0.0.0:5000")
}

func extractEmailFromHeader(rawEmail string) string {
    lines := strings.Split(rawEmail, "\n")
    for _, line := range lines {
        trimmedLine := strings.TrimSpace(line)
        if strings.HasPrefix(strings.ToLower(trimmedLine), "from:") {
            // Extract everything after "From:"
            fromContent := trimmedLine[5:] // Remove "From:"
            
            // Look for email in angle brackets first
            if start := strings.Index(fromContent, "<"); start != -1 {
                if end := strings.Index(fromContent, ">"); end != -1 && end > start {
                    return strings.TrimSpace(fromContent[start+1:end])
                }
            }
            
            // Otherwise look for @ symbol
            parts := strings.Fields(fromContent)
            for _, part := range parts {
                if strings.Contains(part, "@") {
                    return strings.Trim(part, "<>")
                }
            }
        }
    }
    return ""
}

func containsUnsubscribeKeywords(rawEmail string) bool {
    lowerEmail := strings.ToLower(rawEmail)
    
    // Keywords to check for
    keywords := []string{
        "unsubscribe",
        "remove me",
        "deregister me",
        "stop sending me",
        "delete me",
    }
    
    for _, keyword := range keywords {
        if strings.Contains(lowerEmail, keyword) {
            return true
        }
    }
    
    return false
}