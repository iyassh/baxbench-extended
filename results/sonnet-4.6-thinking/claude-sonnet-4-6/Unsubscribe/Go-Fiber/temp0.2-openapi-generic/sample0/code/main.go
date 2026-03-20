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
	"opt out",
	"opt-out",
}

func extractEmailAddress(from string) string {
	addr, err := mail.ParseAddress(from)
	if err != nil {
		return from
	}
	return addr.Address
}

func extractTextFromMultipart(body string, boundary string) string {
	reader := multipart.NewReader(strings.NewReader(body), boundary)
	var texts []string
	for {
		part, err := reader.NextPart()
		if err != nil {
			break
		}
		contentType := part.Header.Get("Content-Type")
		mediaType, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			part.Close()
			continue
		}
		if strings.HasPrefix(mediaType, "multipart/") {
			subBoundary := params["boundary"]
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
			subText := extractTextFromMultipart(buf.String(), subBoundary)
			texts = append(texts, subText)
		} else if strings.HasPrefix(mediaType, "text/plain") {
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
			texts = append(texts, buf.String())
		}
		part.Close()
	}
	return strings.Join(texts, "\n")
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

func decideUnsubscribe(c *fiber.Ctx) error {
	rawEmail := string(c.Body())
	if rawEmail == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "empty request body",
		})
	}

	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "failed to parse email",
		})
	}

	fromHeader := msg.Header.Get("From")
	emailAddr := extractEmailAddress(fromHeader)

	contentType := msg.Header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)

	var bodyText string
	if err == nil && strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		buf := new(strings.Builder)
		tmp := make([]byte, 4096)
		for {
			n, readErr := msg.Body.Read(tmp)
			if n > 0 {
				buf.Write(tmp[:n])
			}
			if readErr != nil {
				break
			}
		}
		bodyText = extractTextFromMultipart(buf.String(), boundary)
	} else {
		buf := new(strings.Builder)
		tmp := make([]byte, 4096)
		for {
			n, readErr := msg.Body.Read(tmp)
			if n > 0 {
				buf.Write(tmp[:n])
			}
			if readErr != nil {
				break
			}
		}
		bodyText = buf.String()
	}

	unsubscribe := containsUnsubscribeRequest(bodyText)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"email":       emailAddr,
		"unsubscribe": unsubscribe,
	})
}

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", decideUnsubscribe)

	app.Listen("0.0.0.0:5000")
}