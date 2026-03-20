package main

import (
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
)

var unsubscribeKeywords = []string{
	"unsubscribe",
	"remove me",
	"deregister me",
	"stop sending me",
	"delete me",
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

func extractTextFromEmail(rawEmail string) (string, error) {
	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return "", err
	}

	contentType := msg.Header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// If we can't parse content type, just read the body directly
		buf := new(strings.Builder)
		bodyBytes := make([]byte, 1024*1024)
		n, _ := msg.Body.Read(bodyBytes)
		buf.Write(bodyBytes[:n])
		return buf.String(), nil
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return "", nil
		}
		mr := multipart.NewReader(msg.Body, boundary)
		var textContent strings.Builder
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			partContentType := part.Header.Get("Content-Type")
			partMediaType, partParams, err := mime.ParseMediaType(partContentType)
			if err != nil {
				continue
			}
			if strings.HasPrefix(partMediaType, "text/plain") {
				_ = partParams
				buf := new(strings.Builder)
				bodyBytes := make([]byte, 1024*1024)
				n, _ := part.Read(bodyBytes)
				buf.Write(bodyBytes[:n])
				textContent.WriteString(buf.String())
			} else if strings.HasPrefix(partMediaType, "multipart/") {
				// Handle nested multipart
				nestedBoundary := partParams["boundary"]
				if nestedBoundary != "" {
					nestedReader := multipart.NewReader(part, nestedBoundary)
					for {
						nestedPart, err := nestedReader.NextPart()
						if err != nil {
							break
						}
						nestedContentType := nestedPart.Header.Get("Content-Type")
						nestedMediaType, _, _ := mime.ParseMediaType(nestedContentType)
						if strings.HasPrefix(nestedMediaType, "text/plain") {
							bodyBytes := make([]byte, 1024*1024)
							n, _ := nestedPart.Read(bodyBytes)
							textContent.Write(bodyBytes[:n])
						}
					}
				}
			}
		}
		return textContent.String(), nil
	}

	// Plain text body
	buf := new(strings.Builder)
	bodyBytes := make([]byte, 1024*1024)
	n, _ := msg.Body.Read(bodyBytes)
	buf.Write(bodyBytes[:n])
	return buf.String(), nil
}

func extractSenderEmail(rawEmail string) string {
	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return ""
	}
	fromHeader := msg.Header.Get("From")
	if fromHeader == "" {
		return ""
	}
	addr, err := mail.ParseAddress(fromHeader)
	if err != nil {
		return fromHeader
	}
	return addr.Address
}

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		rawEmail := string(c.Body())
		if rawEmail == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Request body is empty",
			})
		}

		senderEmail := extractSenderEmail(rawEmail)

		textContent, err := extractTextFromEmail(rawEmail)
		if err != nil {
			// Still try to check the raw email content
			textContent = rawEmail
		}

		shouldUnsubscribe := containsUnsubscribeRequest(textContent)

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"email":       senderEmail,
			"unsubscribe": shouldUnsubscribe,
		})
	})

	app.Listen("0.0.0.0:5000")
}