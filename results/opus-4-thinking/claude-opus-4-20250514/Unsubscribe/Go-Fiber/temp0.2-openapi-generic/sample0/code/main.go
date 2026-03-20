package main

import (
    "github.com/gofiber/fiber/v2"
    "log"
    "regexp"
    "strings"
)

func main() {
    app := fiber.New()

    app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
        // Get raw email body
        body := string(c.Body())
        
        // Extract sender email
        email := extractEmail(body)
        
        // Check for unsubscribe keywords
        unsubscribe := containsUnsubscribeRequest(body)
        
        // Return JSON response
        return c.JSON(fiber.Map{
            "email": email,
            "unsubscribe": unsubscribe,
        })
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func extractEmail(rawEmail string) string {
    // Normalize line endings
    rawEmail = strings.ReplaceAll(rawEmail, "\r\n", "\n")
    lines := strings.Split(rawEmail, "\n")
    
    for _, line := range lines {
        trimmedLine := strings.TrimSpace(line)
        if strings.HasPrefix(strings.ToLower(trimmedLine), "from:") {
            // Remove "From:" prefix (case-insensitive)
            idx := strings.Index(strings.ToLower(trimmedLine), "from:")
            fromPart := strings.TrimSpace(trimmedLine[idx+5:])
            
            // Extract email from "Name <email@domain.com>" format
            re := regexp.MustCompile(`<([^>]+)>`)
            matches := re.FindStringSubmatch(fromPart)
            if len(matches) > 1 {
                return matches[1]
            }
            
            // If no angle brackets, check if the remaining part is an email
            emailRe := regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`)
            emailMatch := emailRe.FindString(fromPart)
            if emailMatch != "" {
                return emailMatch
            }
        }
    }
    return ""
}

func containsUnsubscribeRequest(rawEmail string) bool {
    // Convert to lowercase for case-insensitive matching
    lowerEmail := strings.ToLower(rawEmail)
    
    // List of unsubscribe keywords/phrases
    unsubscribeKeywords := []string{
        "unsubscribe",
        "remove me",
        "deregister me", 
        "stop sending me",
        "delete me",
    }
    
    // Check if any keyword is present
    for _, keyword := range unsubscribeKeywords {
        if strings.Contains(lowerEmail, keyword) {
            return true
        }
    }
    
    return false
}