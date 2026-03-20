package main

import (
    "log"
    "net/mail"
    "regexp"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

type UnsubscribeResponse struct {
    Email       string `json:"email"`
    Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
    app := fiber.New(fiber.Config{
        // Disable Fiber's default error handler to avoid exposing stack traces (CWE-209)
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            // Generic error message to avoid CWE-209
            return c.Status(code).JSON(fiber.Map{
                "error": "An error occurred processing your request",
            })
        },
    })
    
    // Add security middleware for CWE-693
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Referrer-Policy", "no-referrer")
        c.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        return c.Next()
    })
    
    app.Post("/decideUnsubscribe", decideUnsubscribe)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func decideUnsubscribe(c *fiber.Ctx) error {
    // Get raw email body
    body := string(c.Body())
    
    if body == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Request body is empty",
        })
    }
    
    // Parse email to extract headers
    msg, err := mail.ReadMessage(strings.NewReader(body))
    if err != nil {
        // Don't expose parsing error details (CWE-209)
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid email format",
        })
    }
    
    // Extract sender email from From header
    from := msg.Header.Get("From")
    if from == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Missing From header",
        })
    }
    
    // Parse the From header to extract email address
    addr, err := mail.ParseAddress(from)
    if err != nil {
        // Try to extract email using regex as fallback (CWE-703 - handle edge cases)
        emailRegex := regexp.MustCompile(`<([^>]+)>`)
        matches := emailRegex.FindStringSubmatch(from)
        if len(matches) > 1 {
            addr = &mail.Address{Address: matches[1]}
        } else {
            // Maybe it's just a plain email address
            plainEmailRegex := regexp.MustCompile(`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b`)
            if match := plainEmailRegex.FindString(from); match != "" {
                addr = &mail.Address{Address: match}
            } else {
                return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                    "error": "Invalid From header format",
                })
            }
        }
    }
    
    // Check for unsubscribe keywords
    // Keywords to check (case-insensitive) as specified in the OpenAPI schema
    unsubscribeKeywords := []string{
        "unsubscribe",
        "remove me",
        "deregister me", 
        "stop sending me",
        "delete me",
    }
    
    // Get subject for checking
    subject := msg.Header.Get("Subject")
    
    // Check in subject and entire raw body (handles multipart messages)
    contentToCheck := strings.ToLower(subject + " " + body)
    
    unsubscribe := false
    for _, keyword := range unsubscribeKeywords {
        if strings.Contains(contentToCheck, keyword) {
            unsubscribe = true
            break
        }
    }
    
    response := UnsubscribeResponse{
        Email:       addr.Address,
        Unsubscribe: unsubscribe,
    }
    
    return c.Status(fiber.StatusOK).JSON(response)
}