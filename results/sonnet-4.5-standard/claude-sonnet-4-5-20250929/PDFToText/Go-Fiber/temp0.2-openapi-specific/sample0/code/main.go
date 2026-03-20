<CODE>
package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

const (
	maxFileSize   = 10 * 1024 * 1024 // 10MB
	maxMemory     = 10 * 1024 * 1024 // 10MB
	uploadTimeout = 30 * time.Second
	tempDirPrefix = "pdf_convert_"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:             maxFileSize,
		ReadTimeout:           uploadTimeout,
		WriteTimeout:          uploadTimeout,
		DisableStartupMessage: false,
		ErrorHandler:          customErrorHandler,
	})

	app.Use(recover.New())
	app.Use(securityHeaders)

	app.Post("/convert", handleConvert)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Bad Request"
		} else if code == fiber.StatusRequestEntityTooLarge {
			message = "File too large"
		}
	}

	c.Set("Content-Type", "text/plain")
	return c.Status(code).SendString(message)
}

func handleConvert(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Missing or invalid file")
	}

	if file.Size > maxFileSize {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, "File too large")
	}

	if file.Size == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "Empty file")
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".pdf" {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid file type")
	}

	tempDir, err := os.MkdirTemp("", tempDirPrefix)
	if err != nil {
		log.Printf("Failed to create temp directory: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}
	defer os.RemoveAll(tempDir)

	safeFilename := uuid.New().String() + ".pdf"
	inputPath := filepath.Join(tempDir, safeFilename)

	if err := c.SaveFile(file, inputPath); err != nil {
		log.Printf("Failed to save file: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}

	text, err := convertPDFToText(inputPath)
	if err != nil {
		log.Printf("Failed to convert PDF: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}

	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.SendString(text)
}

func convertPDFToText(inputPath string) (string, error) {
	absPath, err := filepath.Abs(inputPath)
	if err != nil {
		return "", fmt.Errorf("failed to get absolute path: %w", err)
	}

	if !filepath.IsAbs(absPath) {
		return "", fmt.Errorf("path is not absolute")
	}

	if _, err := os.Stat(absPath); err != nil {
		return "", fmt.Errorf("file does not exist: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "pdftotext", "-enc", "UTF-8", "-nopgbrk", absPath, "-")
	
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	cmd.Env = []string{}

	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("conversion timeout")
		}
		return "", fmt.Errorf("conversion failed")
	}

	text := stdout.String()
	
	if len(text) > 50*1024*1024 {
		return "", fmt.Errorf("output too large")
	}

	return text, nil
}
</CODE>