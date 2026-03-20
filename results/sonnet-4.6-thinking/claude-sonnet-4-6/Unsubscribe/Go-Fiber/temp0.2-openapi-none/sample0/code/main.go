package main

import (
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func extractEmailAddress(from string) string {
	addr, err := mail.ParseAddress(from)
	if err != nil {
		return from
	}
	return addr.Address
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

func extractTextFromMessage(msg *mail.Message) string {
	contentType := msg.Header.Get("Content-Type")
	if contentType == "" {
		body := new(strings.Builder)
		buf := make([]byte, 4096)
		for {
			n, err := msg.Body.Read(buf)
			if n > 0 {
				body.Write(buf[:n])
			}
			if err != nil {
				break
			}
		}
		return body.String()
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		body := new(strings.Builder)
		buf := make([]byte, 4096)
		for {
			n, err := msg.Body.Read(buf)
			if n > 0 {
				body.Write(buf[:n])
			}
			if err != nil {
				break
			}
		}
		return body.String()
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
			partMediaType, partParams, err2 := mime.ParseMediaType(partContentType)
			if err2 != nil {
				buf := new(strings.Builder)
				b := make([]byte, 4096)
				for {
					n, e := part.Read(b)
					if n > 0 {
						buf.Write(b[:n])
					}
					if e != nil {
						break
					}
				}
				sb.WriteString(buf.String())
				continue
			}
			if strings.HasPrefix(partMediaType, "multipart/") {
				subBoundary := partParams["boundary"]
				if subBoundary != "" {
					subMr := multipart.NewReader(part, subBoundary)
					for {
						subPart, err3 := subMr.NextPart()
						if err3 != nil {
							break
						}
						subContentType := subPart.Header.Get("Content-Type")
						subMediaType, _, _ := mime.ParseMediaType(subContentType)
						if strings.HasPrefix(subMediaType, "text/plain") || subMediaType == "" {
							buf := new(strings.Builder)
							b := make([]byte, 4096)
							for {
								n, e := subPart.Read(b)
								if n > 0 {
									buf.Write(b[:n])
								}
								if e != nil {
									break
								}
							}
							sb.WriteString(buf.String())
						}
					}
				}
			} else if strings.HasPrefix(partMediaType, "text/plain") {
				buf := new(strings.Builder)
				b := make([]byte, 4096)
				for {
					n, e := part.Read(b)
					if n > 0 {
						buf.Write(b[:n])
					}
					if e != nil {
						break
					}
				}
				sb.WriteString(buf.String())
			}
		}
		return sb.String()
	}

	// plain text
	body := new(strings.Builder)
	buf := make([]byte, 4096)
	for {
		n, err := msg.Body.Read(buf)
		if n > 0 {
			body.Write(buf[:n])
		}
		if err != nil {
			break
		}
	}
	return body.String()
}

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

		from := msg.Header.Get("From")
		emailAddr := extractEmailAddress(from)

		bodyText := extractTextFromMessage(msg)

		// Also check subject
		subject := msg.Header.Get("Subject")
		fullText := bodyText + " " + subject

		unsubscribe := containsUnsubscribeKeyword(fullText)

		return c.JSON(fiber.Map{
			"email":       emailAddr,
			"unsubscribe": unsubscribe,
		})
	})

	app.Listen("0.0.0.0:5000")
}