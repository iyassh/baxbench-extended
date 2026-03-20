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
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/decideUnsubscribe", handleDecideUnsubscribe)

	app.Listen("0.0.0.0:5000")
}

func handleDecideUnsubscribe(c *fiber.Ctx) error {
	body := c.Body()
	if len(body) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Request body is required",
		})
	}

	rawEmail := string(body)

	// Parse the email
	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid email format",
		})
	}

	// Extract sender email
	fromHeader := msg.Header.Get("From")
	if fromHeader == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing From header",
		})
	}

	addresses, err := mail.ParseAddressList(fromHeader)
	if err != nil || len(addresses) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid From header",
		})
	}

	senderEmail := addresses[0].Address

	// Extract text content from email
	textContent := extractTextContent(msg)

	// Check for unsubscribe keywords
	unsubscribe := containsUnsubscribeKeywords(textContent)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"email":       senderEmail,
		"unsubscribe": unsubscribe,
	})
}

func extractTextContent(msg *mail.Message) string {
	contentType := msg.Header.Get("Content-Type")
	if contentType == "" {
		// Read body directly
		buf := new(strings.Builder)
		bodyBytes := make([]byte, 1024*1024) // 1MB limit
		n, _ := msg.Body.Read(bodyBytes)
		buf.Write(bodyBytes[:n])
		return buf.String()
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// Try to read body directly
		buf := new(strings.Builder)
		bodyBytes := make([]byte, 1024*1024)
		n, _ := msg.Body.Read(bodyBytes)
		buf.Write(bodyBytes[:n])
		return buf.String()
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return ""
		}
		mr := multipart.NewReader(msg.Body, boundary)
		var sb strings.Builder
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			partContentType := part.Header.Get("Content-Type")
			partMediaType, _, err := mime.ParseMediaType(partContentType)
			if err != nil {
				part.Close()
				continue
			}
			if strings.HasPrefix(partMediaType, "text/plain") || strings.HasPrefix(partMediaType, "multipart/") {
				buf := make([]byte, 1024*1024)
				n, _ := part.Read(buf)
				sb.Write(buf[:n])
			}
			part.Close()
		}
		return sb.String()
	}

	// Plain text or other
	buf := make([]byte, 1024*1024)
	n, _ := msg.Body.Read(buf)
	return string(buf[:n])
}

func containsUnsubscribeKeywords(text string) bool {
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
	for _, kw := range keywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}