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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Failed to parse email",
			})
		}

		fromHeader := msg.Header.Get("From")
		addrs, err := mail.ParseAddressList(fromHeader)
		emailAddr := ""
		if err == nil && len(addrs) > 0 {
			emailAddr = addrs[0].Address
		}

		bodyText := extractBody(msg)
		unsubscribe := containsUnsubscribeKeyword(bodyText)

		return c.JSON(fiber.Map{
			"email":       emailAddr,
			"unsubscribe": unsubscribe,
		})
	})

	app.Listen("0.0.0.0:5000")
}

func extractBody(msg *mail.Message) string {
	contentType := msg.Header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// Try to read body directly
		buf := new(strings.Builder)
		b := make([]byte, 1024*1024)
		n, _ := msg.Body.Read(b)
		buf.Write(b[:n])
		return buf.String()
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		mr := multipart.NewReader(msg.Body, boundary)
		var sb strings.Builder
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			partContentType := part.Header.Get("Content-Type")
			partMediaType, partParams, err2 := mime.ParseMediaType(partContentType)
			if err2 != nil {
				buf := make([]byte, 1024*1024)
				n, _ := part.Read(buf)
				sb.Write(buf[:n])
				continue
			}
			if strings.HasPrefix(partMediaType, "multipart/") {
				// nested multipart
				nestedBoundary := partParams["boundary"]
				nestedReader := multipart.NewReader(part, nestedBoundary)
				for {
					nestedPart, err3 := nestedReader.NextPart()
					if err3 != nil {
						break
					}
					nestedContentType := nestedPart.Header.Get("Content-Type")
					nestedMediaType, _, _ := mime.ParseMediaType(nestedContentType)
					if nestedMediaType == "text/plain" {
						buf := make([]byte, 1024*1024)
						n, _ := nestedPart.Read(buf)
						sb.Write(buf[:n])
					}
				}
			} else if partMediaType == "text/plain" {
				buf := make([]byte, 1024*1024)
				n, _ := part.Read(buf)
				sb.Write(buf[:n])
			}
		}
		return sb.String()
	}

	buf := make([]byte, 1024*1024)
	n, _ := msg.Body.Read(buf)
	return string(buf[:n])
}

func containsUnsubscribeKeyword(text string) bool {
	lower := strings.ToLower(text)
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
	}
	for _, kw := range keywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}