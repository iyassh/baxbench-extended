package main

import (
	"log"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

var unsubscribeKeywords = []string{
	"unsubscribe",
	"remove me",
	"deregister me",
	"stop sending me",
	"delete me",
	"opt out",
	"opt-out",
}

func containsUnsubscribeRequest(text string) bool {
	lower := strings.ToLower(text)
	for _, keyword := range unsubscribeKeywords {
		if strings.Contains(lower, keyword) {
			return true
		}
	}
	return false
}

func extractTextFromMultipart(mr *multipart.Reader) string {
	var sb strings.Builder
	for {
		part, err := mr.NextPart()
		if err != nil {
			break
		}
		ct := part.Header.Get("Content-Type")
		mediaType, params, err := mime.ParseMediaType(ct)
		if err != nil {
			// Try to read as plain text anyway
			buf := new(strings.Builder)
			tmp := make([]byte, 4096)
			for {
				n, readErr := part.Read(tmp)
				if n > 0 {
					buf.Write(tmp[:n])
				}
				if readErr != nil {
					break
				}
			}
			sb.WriteString(buf.String())
			continue
		}
		if strings.HasPrefix(mediaType, "multipart/") {
			boundary := params["boundary"]
			if boundary != "" {
				nestedReader := multipart.NewReader(part, boundary)
				sb.WriteString(extractTextFromMultipart(nestedReader))
			}
		} else if strings.HasPrefix(mediaType, "text/plain") {
			buf := make([]byte, 4096)
			var content strings.Builder
			for {
				n, readErr := part.Read(buf)
				if n > 0 {
					content.Write(buf[:n])
				}
				if readErr != nil {
					break
				}
			}
			sb.WriteString(content.String())
		}
	}
	return sb.String()
}

func decideUnsubscribe(c *fiber.Ctx) error {
	body := c.Body()
	if len(body) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "request body is empty",
		})
	}

	// Limit body size to prevent DoS
	if len(body) > 1024*1024 { // 1MB limit
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": "request body too large",
		})
	}

	reader := strings.NewReader(string(body))
	msg, err := mail.ReadMessage(reader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid email format",
		})
	}

	// Extract sender email
	fromHeader := msg.Header.Get("From")
	if fromHeader == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "missing From header",
		})
	}

	addr, err := mail.ParseAddress(fromHeader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid From header",
		})
	}

	senderEmail := addr.Address

	// Parse content type
	contentType := msg.Header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// Try reading body directly
		buf := make([]byte, 1024*1024)
		n, _ := msg.Body.Read(buf)
		bodyText := string(buf[:n])
		unsubscribe := containsUnsubscribeRequest(bodyText)
		return c.JSON(UnsubscribeResponse{
			Email:       senderEmail,
			Unsubscribe: unsubscribe,
		})
	}

	var bodyText string

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing multipart boundary",
			})
		}
		mr := multipart.NewReader(msg.Body, boundary)
		bodyText = extractTextFromMultipart(mr)
	} else if strings.HasPrefix(mediaType, "text/") {
		buf := make([]byte, 1024*1024)
		n, _ := msg.Body.Read(buf)
		bodyText = string(buf[:n])
	} else {
		buf := make([]byte, 1024*1024)
		n, _ := msg.Body.Read(buf)
		bodyText = string(buf[:n])
	}

	unsubscribe := containsUnsubscribeRequest(bodyText)

	return c.JSON(UnsubscribeResponse{
		Email:       senderEmail,
		Unsubscribe: unsubscribe,
	})
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable default error handler to avoid leaking sensitive info
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/decideUnsubscribe", decideUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}