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
		// Disable detailed error messages to avoid leaking sensitive info (CWE-209)
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
	// Validate content type
	contentType := c.Get("Content-Type")
	if contentType != "" && !strings.HasPrefix(contentType, "text/plain") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid content type"})
	}

	rawEmail := string(c.Body())
	if len(rawEmail) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Empty request body"})
	}

	// Parse the email
	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to parse email"})
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

	// Extract the body text from the email
	bodyText, err := extractBodyText(msg)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to read email body"})
	}

	// Check for unsubscribe keywords
	unsubscribe := containsUnsubscribeRequest(bodyText)

	// Also check the subject line
	subject := msg.Header.Get("Subject")
	if containsUnsubscribeRequest(subject) {
		unsubscribe = true
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"email":       emailAddress,
		"unsubscribe": unsubscribe,
	})
}

func extractBodyText(msg *mail.Message) (string, error) {
	contentType := msg.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "text/plain"
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// If we can't parse the content type, try reading body as plain text
		buf := new(strings.Builder)
		limitedReader := &strings.Builder{}
		body := make([]byte, 1024*1024) // 1MB limit
		n, _ := msg.Body.Read(body)
		_ = limitedReader
		buf.Write(body[:n])
		return buf.String(), nil
	}

	if strings.HasPrefix(mediaType, "text/") {
		buf := new(strings.Builder)
		body := make([]byte, 1024*1024)
		n, _ := msg.Body.Read(body)
		buf.Write(body[:n])
		return buf.String(), nil
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary, ok := params["boundary"]
		if !ok {
			return "", nil
		}
		return extractFromMultipart(msg.Body, boundary)
	}

	return "", nil
}

func extractFromMultipart(body interface{ Read([]byte) (int, error) }, boundary string) (string, error) {
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
			continue
		}

		if strings.HasPrefix(partMediaType, "multipart/") {
			partBoundary, ok := partParams["boundary"]
			if ok {
				nested, nestedErr := extractFromMultipart(part, partBoundary)
				if nestedErr == nil {
					textContent.WriteString(nested)
					textContent.WriteString(" ")
				}
			}
		} else if partMediaType == "text/plain" || partMediaType == "text/html" {
			buf := make([]byte, 1024*1024)
			n, _ := part.Read(buf)
			textContent.Write(buf[:n])
			textContent.WriteString(" ")
		}

		part.Close()
	}

	return textContent.String(), nil
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