package main

import (
    "log"
    "net/mail"
    "regexp"
    "strings"

    "github.com/gofiber/fiber/v2"
)

type DecideUnsubscribeResponse struct {
    Email       string `json:"email"`
    Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
    app := fiber.New(fiber.Config{
        // Disable default error handler that might expose sensitive info
        DisableStartupMessage: true,
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            // Generic error response to avoid CWE-209
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return ctx.Status(code).JSON(fiber.Map{
                "error": "An error occurred processing the request",
            })
        },
    })

    // Add security headers middleware (CWE-693)
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Post("/decideUnsubscribe", handleDecideUnsubscribe)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleDecideUnsubscribe(c *fiber.Ctx) error {
    // Get the raw email content
    emailContent := string(c.Body())
    
    if emailContent == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Request body is required",
        })
    }

    // Extract email address and check for unsubscribe keywords
    emailAddress := extractEmailAddress(emailContent)
    shouldUnsubscribe := containsUnsubscribeKeywords(emailContent)

    response := DecideUnsubscribeResponse{
        Email:       emailAddress,
        Unsubscribe: shouldUnsubscribe,
    }

    return c.JSON(response)
}

func extractEmailAddress(emailContent string) string {
    // Try to parse as RFC822 message
    msg, err := mail.ReadMessage(strings.NewReader(emailContent))
    if err != nil {
        // Fallback: try to extract email from From: header using regex
        fromRegex := regexp.MustCompile(`(?i)From:\s*(?:.*?<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:>)?`)
        matches := fromRegex.FindStringSubmatch(emailContent)
        if len(matches) > 1 {
            return matches[1]
        }
        return ""
    }

    // Get the From header
    fromHeader := msg.Header.Get("From")
    if fromHeader == "" {
        return ""
    }

    // Parse the From address
    address, err := mail.ParseAddress(fromHeader)
    if err != nil {
        // Try to extract email using regex as fallback
        emailRegex := regexp.MustCompile(`([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})`)
        matches := emailRegex.FindStringSubmatch(fromHeader)
        if len(matches) > 0 {
            return matches[0]
        }
        return ""
    }

    return address.Address
}

func containsUnsubscribeKeywords(emailContent string) bool {
    // Convert to lowercase for case-insensitive matching
    lowerContent := strings.ToLower(emailContent)
    
    // List of unsubscribe-related keywords and phrases
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
        "stop emails",
        "stop email",
        "no more emails",
        "no more email",
        "take me off",
        "remove from list",
        "remove my email",
        "don't send me",
        "do not send me",
        "stop these emails",
        "stop this email",
    }
    
    // Check if any of the keywords are present
    for _, keyword := range unsubscribeKeywords {
        if strings.Contains(lowerContent, keyword) {
            return true
        }
    }
    
    return false
}