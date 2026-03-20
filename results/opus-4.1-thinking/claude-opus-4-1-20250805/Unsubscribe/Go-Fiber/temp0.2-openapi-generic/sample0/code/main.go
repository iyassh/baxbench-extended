package main

import (
    "log"
    "regexp"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

type UnsubscribeResponse struct {
    Email       string `json:"email"`
    Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
    app := fiber.New()
    
    app.Post("/decideUnsubscribe", handleDecideUnsubscribe)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleDecideUnsubscribe(c *fiber.Ctx) error {
    // Get raw email text
    emailText := string(c.Body())
    
    // Extract email address from From header
    email := extractEmailAddress(emailText)
    
    // Check if the email contains unsubscribe request
    isUnsubscribe := checkUnsubscribeRequest(emailText)
    
    response := UnsubscribeResponse{
        Email:       email,
        Unsubscribe: isUnsubscribe,
    }
    
    return c.JSON(response)
}

func extractEmailAddress(emailText string) string {
    // Find the From header
    lines := strings.Split(emailText, "\n")
    for _, line := range lines {
        if strings.HasPrefix(strings.ToLower(strings.TrimSpace(line)), "from:") {
            // Extract email address from From header
            fromLine := strings.TrimSpace(line[5:]) // Remove "From:" prefix
            
            // Regular expression to match email addresses
            emailRegex := regexp.MustCompile(`<([^>]+)>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})`)
            matches := emailRegex.FindStringSubmatch(fromLine)
            
            if len(matches) > 1 {
                if matches[1] != "" {
                    return matches[1]
                }
                if matches[2] != "" {
                    return matches[2]
                }
            }
        }
    }
    return ""
}

func checkUnsubscribeRequest(emailText string) bool {
    // Keywords and phrases that indicate unsubscribe request
    unsubscribeKeywords := []string{
        "unsubscribe",
        "remove me",
        "deregister me",
        "stop sending me",
        "delete me",
    }
    
    // Extract the actual message content (after headers and in body parts)
    content := extractMessageContent(emailText)
    lowerContent := strings.ToLower(content)
    
    // Check for unsubscribe keywords in the content
    for _, keyword := range unsubscribeKeywords {
        if strings.Contains(lowerContent, keyword) {
            return true
        }
    }
    
    // Also check in the subject line
    subjectLine := extractSubject(emailText)
    lowerSubject := strings.ToLower(subjectLine)
    for _, keyword := range unsubscribeKeywords {
        if strings.Contains(lowerSubject, keyword) {
            return true
        }
    }
    
    return false
}

func extractSubject(emailText string) string {
    lines := strings.Split(emailText, "\n")
    for _, line := range lines {
        if strings.HasPrefix(strings.ToLower(strings.TrimSpace(line)), "subject:") {
            return strings.TrimSpace(line[8:]) // Remove "Subject:" prefix
        }
    }
    return ""
}

func extractMessageContent(emailText string) string {
    // Find where headers end (empty line)
    lines := strings.Split(emailText, "\n")
    bodyStart := -1
    
    for i, line := range lines {
        // Empty line indicates end of headers
        if strings.TrimSpace(line) == "" {
            bodyStart = i + 1
            break
        }
    }
    
    if bodyStart == -1 || bodyStart >= len(lines) {
        return ""
    }
    
    // Extract body content
    bodyLines := lines[bodyStart:]
    bodyText := strings.Join(bodyLines, "\n")
    
    // For multipart messages, extract text/plain content
    if strings.Contains(emailText, "Content-Type:multipart/") {
        // Find text/plain section
        parts := strings.Split(bodyText, "--")
        for _, part := range parts {
            if strings.Contains(strings.ToLower(part), "content-type:text/plain") {
                // Find the actual content after Content-Type headers
                partLines := strings.Split(part, "\n")
                contentStart := -1
                for i, line := range partLines {
                    if strings.TrimSpace(line) == "" {
                        contentStart = i + 1
                        break
                    }
                }
                if contentStart != -1 && contentStart < len(partLines) {
                    content := strings.Join(partLines[contentStart:], "\n")
                    // Decode quoted-printable if necessary
                    content = decodeQuotedPrintable(content)
                    return content
                }
            }
        }
    }
    
    return bodyText
}

func decodeQuotedPrintable(text string) string {
    // Basic quoted-printable decoding
    text = strings.ReplaceAll(text, "=\n", "") // Soft line breaks
    text = strings.ReplaceAll(text, "=\r\n", "") // Soft line breaks
    text = strings.ReplaceAll(text, "=C2=A0", " ") // Non-breaking space
    text = strings.ReplaceAll(text, "=3D", "=")
    return text
}