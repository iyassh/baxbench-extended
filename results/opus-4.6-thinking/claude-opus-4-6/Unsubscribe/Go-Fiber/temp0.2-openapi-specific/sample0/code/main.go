package main

import (
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/decideUnsubscribe", handleDecideUnsubscribe)

	_ = app.Listen("0.0.0.0:5000")
}

func handleDecideUnsubscribe(c *fiber.Ctx) error {
	body := string(c.Body())
	if len(body) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Request body is required"})
	}

	// Parse the email
	msg, err := mail.ReadMessage(strings.NewReader(body))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid email format"})
	}

	// Extract the sender's email address
	fromHeader := msg.Header.Get("From")
	if fromHeader == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing From header"})
	}

	addr, err := mail.ParseAddress(fromHeader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid From address"})
	}

	emailAddress := addr.Address

	// Extract the text content from the email
	textContent := extractTextContent(msg)

	// Check for unsubscribe keywords
	unsubscribe := containsUnsubscribeRequest(textContent)

	// Also check the subject line
	subject := msg.Header.Get("Subject")
	if !unsubscribe && containsUnsubscribeRequest(subject) {
		unsubscribe = true
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"email":       emailAddress,
		"unsubscribe": unsubscribe,
	})
}

func extractTextContent(msg *mail.Message) string {
	contentType := msg.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "text/plain"
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// If we can't parse content type, try reading body as plain text
		buf := new(strings.Builder)
		_, readErr := strings.NewReader("").WriteTo(buf)
		if readErr != nil {
			return ""
		}
		return ""
	}

	if strings.HasPrefix(mediaType, "text/plain") {
		buf := new(strings.Builder)
		bodyBytes := make([]byte, 1024*1024) // limit to 1MB
		n, _ := msg.Body.Read(bodyBytes)
		buf.Write(bodyBytes[:n])
		return buf.String()
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary, ok := params["boundary"]
		if !ok {
			return ""
		}
		return extractFromMultipart(msg.Body, boundary)
	}

	return ""
}

func extractFromMultipart(body interface{ Read([]byte) (int, error) }, boundary string) string {
	reader := multipart.NewReader(body, boundary)
	var textContent strings.Builder

	for {
		part, err := reader.NextPart()
		if err != nil {
			break
		}

		partContentType := part.Header.Get("Content-Type")
		if partContentType == "" {
			partContentType = "text/plain"
		}

		partMediaType, partParams, parseErr := mime.ParseMediaType(partContentType)
		if parseErr != nil {
			_ = part.Close()
			continue
		}

		if strings.HasPrefix(partMediaType, "text/plain") {
			buf := make([]byte, 1024*1024)
			n, _ := part.Read(buf)
			textContent.Write(buf[:n])
		} else if strings.HasPrefix(partMediaType, "multipart/") {
			partBoundary, ok := partParams["boundary"]
			if ok {
				nested := extractFromMultipart(part, partBoundary)
				textContent.WriteString(nested)
			}
		}

		_ = part.Close()
	}

	return textContent.String()
}

func containsUnsubscribeRequest(text string) bool {
	lower := strings.ToLower(text)

	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
		"opt out",
		"opt-out",
	}

	for _, keyword := range keywords {
		if strings.Contains(lower, keyword) {
			return true
		}
	}

	return false
}