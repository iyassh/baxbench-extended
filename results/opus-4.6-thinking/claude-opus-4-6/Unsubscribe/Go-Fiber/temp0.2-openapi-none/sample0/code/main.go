package main

import (
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		rawEmail := string(c.Body())

		msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Failed to parse email"})
		}

		// Extract sender email
		fromHeader := msg.Header.Get("From")
		addr, err := mail.ParseAddress(fromHeader)
		senderEmail := ""
		if err == nil {
			senderEmail = addr.Address
		} else {
			// Fallback: try to extract manually
			senderEmail = fromHeader
		}

		// Extract body text
		bodyText := extractBodyText(msg)

		// Check for unsubscribe keywords
		lower := strings.ToLower(bodyText)
		unsubscribe := false
		keywords := []string{"unsubscribe", "remove me", "deregister me", "stop sending me", "delete me"}
		for _, kw := range keywords {
			if strings.Contains(lower, kw) {
				unsubscribe = true
				break
			}
		}

		// Also check subject
		subject := strings.ToLower(msg.Header.Get("Subject"))
		if !unsubscribe {
			for _, kw := range keywords {
				if strings.Contains(subject, kw) {
					unsubscribe = true
					break
				}
			}
		}

		return c.JSON(fiber.Map{
			"email":       senderEmail,
			"unsubscribe": unsubscribe,
		})
	})

	app.Listen("0.0.0.0:5000")
}

func extractBodyText(msg *mail.Message) string {
	contentType := msg.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "text/plain"
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// Try reading body as plain text
		buf := new(strings.Builder)
		b := make([]byte, 4096)
		for {
			n, readErr := msg.Body.Read(b)
			if n > 0 {
				buf.Write(b[:n])
			}
			if readErr != nil {
				break
			}
		}
		return buf.String()
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return ""
		}
		return extractFromMultipart(msg.Body, boundary)
	}

	// Single part
	buf := new(strings.Builder)
	b := make([]byte, 4096)
	for {
		n, readErr := msg.Body.Read(b)
		if n > 0 {
			buf.Write(b[:n])
		}
		if readErr != nil {
			break
		}
	}
	return buf.String()
}

func extractFromMultipart(body interface{ Read([]byte) (int, error) }, boundary string) string {
	reader := multipart.NewReader(body, boundary)
	var result strings.Builder

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
			partBoundary := partParams["boundary"]
			if partBoundary != "" {
				result.WriteString(extractFromMultipart(part, partBoundary))
			}
		} else if partMediaType == "text/plain" || partMediaType == "text/html" {
			buf := new(strings.Builder)
			b := make([]byte, 4096)
			for {
				n, readErr := part.Read(b)
				if n > 0 {
					buf.Write(b[:n])
				}
				if readErr != nil {
					break
				}
			}
			result.WriteString(buf.String())
			result.WriteString(" ")
		}
	}

	return result.String()
}