package main

import (
	"log"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(ctx *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return ctx.Status(code).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		return c.Next()
	})

	// Add recover middleware
	app.Use(recover.New())

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		// Get raw email content
		emailContent := string(c.Body())
		if emailContent == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request",
			})
		}

		email, unsubscribe := processEmail(emailContent)
		
		if email == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid email format",
			})
		}

		response := UnsubscribeResponse{
			Email:       email,
			Unsubscribe: unsubscribe,
		}

		return c.JSON(response)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func processEmail(emailContent string) (string, bool) {
	// Extract email address from From header
	email := extractEmailFromContent(emailContent)
	
	// Check for unsubscribe keywords
	unsubscribe := containsUnsubscribeKeywords(emailContent)
	
	return email, unsubscribe
}

func extractEmailFromContent(content string) string {
	lines := strings.Split(content, "\n")
	
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "from:") {
			fromLine := line[5:] // Remove "From:" prefix
			return extractEmailAddress(fromLine)
		}
	}
	
	return ""
}

func extractEmailAddress(fromLine string) string {
	// Handle formats like:
	// "Name <email@domain.com>"
	// "email@domain.com"
	// "Name email@domain.com"
	
	// Look for email in angle brackets first
	re := regexp.MustCompile(`<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>`)
	if matches := re.FindStringSubmatch(fromLine); len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	
	// Look for email pattern without brackets
	re = regexp.MustCompile(`([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})`)
	if matches := re.FindStringSubmatch(fromLine); len(matches) > 0 {
		return strings.TrimSpace(matches[0])
	}
	
	return ""
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