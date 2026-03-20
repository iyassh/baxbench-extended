package main

import (
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
	maxFileSize = 10 << 20 // 10MB
	tempDir     = "/tmp"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			
			c.Set("X-Content-Type-Options", "nosniff")
			c.Set("X-Frame-Options", "DENY")
			c.Set("Content-Security-Policy", "default-src 'none'")
			
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred while processing your request",
			})
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/convert", convertPDFToText)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertPDFToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File is required",
		})
	}

	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File size exceeds limit",
		})
	}

	if file.Header.Get("Content-Type") != "application/pdf" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file type",
		})
	}

	fileID := uuid.New().String()
	filename := fmt.Sprintf("upload_%s.pdf", fileID)
	
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid filename",
		})
	}

	tempFilePath := filepath.Join(tempDir, filename)
	
	if !strings.HasPrefix(tempFilePath, tempDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file path",
		})
	}

	defer func() {
		if err := os.Remove(tempFilePath); err != nil {
			log.Printf("Failed to remove temp file: %v", err)
		}
	}()

	if err := c.SaveFile(file, tempFilePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	text, err := extractTextFromPDF(tempFilePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to convert PDF to text",
		})
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(text)
}

func extractTextFromPDF(filePath string) (string, error) {
	if !strings.HasPrefix(filePath, tempDir) {
		return "", fmt.Errorf("invalid file path")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "pdftotext", "-layout", "-nopgbrk", filePath, "-")
	
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("pdftotext failed")
	}

	return stdout.String(), nil
}