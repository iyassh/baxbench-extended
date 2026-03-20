package main

import (
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type DecideResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024, // 10MB limit
	})

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		rawEmail := string(c.Body())
		if len(rawEmail) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "empty request body"})
		}

		msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "failed to parse email: " + err.Error()})
		}

		// Extract sender email
		fromHeader := msg.Header.Get("From")
		addr, err := mail.ParseAddress(fromHeader)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "failed to parse From address: " + err.Error()})
		}
		senderEmail := addr.Address

		// Extract body text
		bodyText := extractBodyText(msg)

		// Also check the subject
		subject := strings.ToLower(msg.Header.Get("Subject"))

		combinedText := strings.ToLower(bodyText) + " " + subject

		unsubscribe := containsUnsubscribeIntent(combinedText)

		return c.JSON(DecideResponse{
			Email:       senderEmail,
			Unsubscribe: unsubscribe,
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
		// Try to read body as plain text
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

	// Single part - read body
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
				nested := extractFromMultipart(part, partBoundary)
				result.WriteString(nested)
				result.WriteString(" ")
			}
		} else if partMediaType == "text/plain" {
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
		} else if partMediaType == "text/html" {
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
		part.Close()
	}

	return result.String()
}

func containsUnsubscribeIntent(text string) bool {
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
		"opt out",
		"opt-out",
		"take me off",
		"remove my email",
		"cancel subscription",
		"cancel my subscription",
	}

	for _, kw := range keywords {
		if strings.Contains(text, kw) {
			return true
		}
	}

	return false
}