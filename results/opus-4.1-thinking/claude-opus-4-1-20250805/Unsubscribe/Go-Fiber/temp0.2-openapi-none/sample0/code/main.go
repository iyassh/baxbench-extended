package main

import (
    "github.com/gofiber/fiber/v2"
    "log"
    "regexp"
    "strings"
)

type UnsubscribeResponse struct {
    Email       string `json:"email"`
    Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
    app := fiber.New()

    app.Post("/decideUnsubscribe", decideUnsubscribe)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func decideUnsubscribe(c *fiber.Ctx) error {
    rawEmail := string(c.Body())
    
    // Extract email from the From: header
    email := extractEmail(rawEmail)
    
    // Check if the email contains unsubscribe keywords
    unsubscribe := containsUnsubscribeRequest(rawEmail)
    
    response := UnsubscribeResponse{
        Email:       email,
        Unsubscribe: unsubscribe,
    }
    
    return c.JSON(response)
}

func extractEmail(rawEmail string) string {
    // Look for From: header with email in angle brackets
    // Pattern: From:Name <email@domain.com> or From:<email@domain.com>
    fromRegex := regexp.MustCompile(`(?i)From:[^<]*<([^>]+)>`)
    matches := fromRegex.FindStringSubmatch(rawEmail)
    
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }
    
    // Fallback: try to find From: header without angle brackets
    fromRegex2 := regexp.MustCompile(`(?i)From:\s*([^\s\n]+)`)
    matches = fromRegex2.FindStringSubmatch(rawEmail)
    
    if len(matches) > 1 {
        return strings.TrimSpace(matches[1])
    }
    
    return ""
}

func containsUnsubscribeRequest(rawEmail string) bool {
    // Convert to lowercase for case-insensitive matching
    lowerEmail := strings.ToLower(rawEmail)
    
    // Keywords and phrases that indicate unsubscribe request
    unsubscribeKeywords := []string{
        "unsubscribe",
        "remove me",
        "deregister me",
        "stop sending me",
        "delete me",
        "opt out",
        "opt-out",
        "cancel subscription",
        "cancel my subscription",
        "stop email",
        "stop these emails",
        "take me off",
    }
    
    for _, keyword := range unsubscribeKeywords {
        if strings.Contains(lowerEmail, keyword) {
            return true
        }
    }
    
    return false
}