package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/timeout"
)

const (
	maxFileSize       = 50 * 1024 * 1024 // 50MB
	maxProcessingTime = 30 * time.Second
	commandTimeout    = 10 * time.Second
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal Server Error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				message = e.Message
			}

			return c.Status(code).JSON(fiber.Map{
				"error": message,
			})
		},
	})

	// Security middleware
	app.Use(helmet.New(helmet.Config{
		XSSProtection:      "1; mode=block",
		ContentTypeNosniff: "nosniff",
		XFrameOptions:      "DENY",
		HSTSMaxAge:         31536000,
		CSPDirectives: map[string]string{
			"default-src": "'self'",
			"script-src":  "'self'",
			"style-src":   "'self' 'unsafe-inline'",
			"img-src":     "'self' data:",
			"connect-src": "'self'",
			"font-src":    "'self'",
			"object-src":  "'none'",
			"media-src":   "'self'",
			"frame-src":   "'none'",
		},
	}))

	// Rate limiting
	app.Use(limiter.New(limiter.Config{
		Max:               10,
		Expiration:        1 * time.Minute,
		LimiterMiddleware: limiter.SlidingWindow{},
	}))

	// Recovery middleware
	app.Use(recover.New())

	// Convert endpoint
	app.Post("/convert", timeout.NewWithContext(func(c *fiber.Ctx) error {
		return handleConvert(c)
	}, maxProcessingTime))

	app.Listen("0.0.0.0:5000")
}

func handleConvert(c *fiber.Ctx) error {
	// Get the uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Missing or invalid file")
	}

	// Validate file
	if file == nil {
		return fiber.NewError(fiber.StatusBadRequest, "No file provided")
	}

	// Check file size
	if file.Size > maxFileSize {
		return fiber.NewError(fiber.StatusBadRequest, "File size exceeds maximum allowed size")
	}

	// Check file extension
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
		return fiber.NewError(fiber.StatusBadRequest, "Only PDF files are supported")
	}

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to process file")
	}
	defer src.Close()

	// Create a secure temporary file
	tempFile, err := createSecureTempFile()
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to process file")
	}
	defer func() {
		tempFile.Close()
		os.Remove(tempFile.Name())
	}()

	// Copy uploaded file to temporary file
	_, err = io.Copy(tempFile, src)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to process file")
	}

	// Close the temp file so pdftotext can read it
	tempFile.Close()

	// Extract text using pdftotext
	text, err := extractTextFromPDF(tempFile.Name())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to extract text from PDF")
	}

	// Set content type and return the text
	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.SendString(text)
}

func createSecureTempFile() (*os.File, error) {
	// Generate a random filename
	randomBytes := make([]byte, 16)
	_, err := rand.Read(randomBytes)
	if err != nil {
		return nil, err
	}

	// Create filename with random component
	filename := fmt.Sprintf("pdf_%x.pdf", randomBytes)

	// Use system temp directory
	tempDir := os.TempDir()
	tempPath := filepath.Join(tempDir, filename)

	// Create the file with restrictive permissions
	return os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0600)
}

func extractTextFromPDF(pdfPath string) (string, error) {
	// Validate the path to prevent directory traversal
	cleanPath := filepath.Clean(pdfPath)
	if !strings.HasPrefix(cleanPath, os.TempDir()) {
		return "", fmt.Errorf("invalid file path")
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()

	// Create the command with context
	cmd := exec.CommandContext(ctx, "pdftotext", "-layout", "-nopgbrk", cleanPath, "-")

	// Set up buffer for output
	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	// Run the command
	err := cmd.Run()
	if err != nil {
		// Don't expose the actual error details to prevent information leakage
		return "", fmt.Errorf("failed to extract text")
	}

	return stdout.String(), nil
}