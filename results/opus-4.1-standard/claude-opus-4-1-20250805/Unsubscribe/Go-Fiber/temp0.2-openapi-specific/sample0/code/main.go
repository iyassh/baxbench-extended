package main

import (
	"encoding/json"
	"log"
	"net/mail"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Add security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/decideUnsubscribe", handleDecideUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}

	// Generic error message to avoid information disclosure
	return c.Status(code).JSON(fiber.Map{
		"error": "An error occurred processing your request",
	})
}

func handleDecideUnsubscribe(c *fiber.Ctx) error {
	// Get raw email content
	rawEmail := string(c.Body())
	
	if len(rawEmail) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	// Parse email safely
	email, body, err := parseEmail(rawEmail)
	if err != nil {
		log.Printf("Error parsing email: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid email format",
		})
	}

	// Check if unsubscribe is requested
	shouldUnsubscribe := checkUnsubscribeRequest(body)

	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: shouldUnsubscribe,
	}

	return c.Status(fiber.StatusOK).JSON(response)
}

func parseEmail(rawEmail string) (string, string, error) {
	// Parse the email message
	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return "", "", err
	}

	// Extract sender email
	from := msg.Header.Get("From")
	if from == "" {
		return "", "", fiber.NewError(fiber.StatusBadRequest, "Missing From header")
	}

	// Parse the From address
	addr, err := mail.ParseAddress(from)
	if err != nil {
		// Try to extract email from raw From header
		emailRegex := regexp.MustCompile(`<([^>]+)>`)
		matches := emailRegex.FindStringSubmatch(from)
		if len(matches) > 1 {
			from = matches[1]
		} else {
			// Assume the whole string is the email
			from = strings.TrimSpace(from)
		}
	} else {
		from = addr.Address
	}

	// Read body
	bodyBytes := make([]byte, 1024*1024) // Limit to 1MB
	n, _ := msg.Body.Read(bodyBytes)
	body := string(bodyBytes[:n])

	// Extract text content from multipart messages
	textContent := extractTextContent(body)

	return from, textContent, nil
}

func extractTextContent(body string) string {
	// Look for plain text content
	textParts := []string{}
	
	// Simple extraction of text/plain content
	lines := strings.Split(body, "\n")
	inTextPart := false
	currentText := []string{}
	
	for _, line := range lines {
		if strings.Contains(strings.ToLower(line), "content-type:text/plain") {
			inTextPart = true
			continue
		}
		if strings.HasPrefix(line, "--") && inTextPart {
			if len(currentText) > 0 {
				textParts = append(textParts, strings.Join(currentText, " "))
			}
			inTextPart = false
			currentText = []string{}
			continue
		}
		if inTextPart && !strings.HasPrefix(line, "Content-") {
			// Decode quoted-printable if needed
			decoded := decodeQuotedPrintable(line)
			if decoded != "" {
				currentText = append(currentText, decoded)
			}
		}
	}
	
	if len(currentText) > 0 {
		textParts = append(textParts, strings.Join(currentText, " "))
	}

	// If no text parts found, use the whole body
	if len(textParts) == 0 {
		return body
	}

	return strings.Join(textParts, " ")
}

func decodeQuotedPrintable(s string) string {
	// Simple quoted-printable decoding
	s = strings.ReplaceAll(s, "=3D", "=")
	s = strings.ReplaceAll(s, "=C2=A0", " ")
	s = strings.TrimSuffix(s, "=")
	return strings.TrimSpace(s)
}

func checkUnsubscribeRequest(body string) bool {
	// Convert to lowercase for case-insensitive matching
	lowerBody := strings.ToLower(body)
	
	// Keywords and phrases that indicate unsubscribe request
	unsubscribePatterns := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending",
		"delete me",
		"opt out",
		"opt-out",
		"cancel subscription",
		"cancel my subscription",
		"remove from list",
		"remove from mailing",
		"take me off",
		"no more emails",
		"stop emails",
	}

	for _, pattern := range unsubscribePatterns {
		if strings.Contains(lowerBody, pattern) {
			return true
		}
	}

	return false
}