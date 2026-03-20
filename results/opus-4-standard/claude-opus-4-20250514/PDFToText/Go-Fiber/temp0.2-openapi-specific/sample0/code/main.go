package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	maxFileSize = 10 * 1024 * 1024 // 10MB
	tempDir     = "/tmp/pdf-converter"
)

func main() {
	// Create temp directory
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		log.Fatal("Failed to create temp directory:", err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		BodyLimit:    maxFileSize,
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())
	app.Use(logger.New())
	
	// Rate limiting
	app.Use(limiter.New(limiter.Config{
		Max:               20,
		Expiration:        1 * time.Minute,
		LimiterMiddleware: limiter.SlidingWindow{},
	}))

	// Custom security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// Routes
	app.Post("/convert", handleConvert)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleConvert(c *fiber.Ctx) error {
	// Parse multipart form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing or invalid file",
		})
	}

	// Validate file size
	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File size exceeds limit",
		})
	}

	// Validate file extension
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file format. Only PDF files are allowed",
		})
	}

	// Generate secure random filename
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	tempFileName := hex.EncodeToString(randomBytes) + ".pdf"
	tempFilePath := filepath.Join(tempDir, tempFileName)

	// Ensure the file path is within the temp directory
	cleanPath := filepath.Clean(tempFilePath)
	if !strings.HasPrefix(cleanPath, tempDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file path",
		})
	}

	// Save uploaded file
	if err := c.SaveFile(file, tempFilePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	// Ensure cleanup
	defer func() {
		if err := os.Remove(tempFilePath); err != nil {
			log.Printf("Failed to remove temp file: %v", err)
		}
	}()

	// Convert PDF to text using pdftotext
	text, err := convertPDFToText(tempFilePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to convert PDF",
		})
	}

	// Return plain text
	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.SendString(text)
}

func convertPDFToText(pdfPath string) (string, error) {
	// Create command with timeout
	ctx, cancel := exec.CommandContext(c.Context(), "pdftotext", "-", "-")
	defer cancel()

	// Set timeout
	cmd := exec.CommandContext(ctx, "pdftotext", pdfPath, "-")
	cmd.Env = []string{"PATH=/usr/bin:/bin"} // Minimal environment

	// Create pipes
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Set resource limits
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

	// Run command with timeout
	done := make(chan error, 1)
	go func() {
		done <- cmd.Run()
	}()

	select {
	case <-time.After(30 * time.Second):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return "", fmt.Errorf("conversion timeout")
	case err := <-done:
		if err != nil {
			// Don't expose internal error details
			return "", fmt.Errorf("conversion failed")
		}
	}

	// Check if output is too large
	output := stdout.String()
	if len(output) > maxFileSize {
		return "", fmt.Errorf("output too large")
	}

	return output, nil
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Bad request"
		}
	}

	c.Set("Content-Type", "application/json")
	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}