package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const maxFileSize = 50 * 1024 * 1024 // 50 MB

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
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

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Missing or invalid file upload.",
			})
		}

		// Validate file size
		if file.Size > maxFileSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File size exceeds the maximum allowed limit.",
			})
		}

		// Validate file extension
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext != ".pdf" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Only PDF files are accepted.",
			})
		}

		// Validate content type
		contentType := file.Header.Get("Content-Type")
		if contentType != "application/pdf" && contentType != "application/octet-stream" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file content type. Only PDF files are accepted.",
			})
		}

		// Create a temporary directory for processing
		tmpDir, err := os.MkdirTemp("", "pdfconvert-")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process the file.",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Generate a safe filename using UUID to prevent path traversal
		safeFilename := uuid.New().String() + ".pdf"
		inputPath := filepath.Join(tmpDir, safeFilename)

		// Save the uploaded file
		if err := c.SaveFile(file, inputPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save the uploaded file.",
			})
		}

		// Verify the saved file is within the temp directory (defense in depth against path traversal)
		absInputPath, err := filepath.Abs(inputPath)
		if err != nil || !strings.HasPrefix(absInputPath, tmpDir) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file path.",
			})
		}

		// Use pdftotext to convert PDF to text
		// Using "-" as output to write to stdout, avoiding need for output file
		// We pass the absolute path directly without any shell interpolation
		cmd := exec.Command("pdftotext", absInputPath, "-")

		output, err := cmd.Output()
		if err != nil {
			var exitErr *exec.ExitError
			if ok := false; func() bool {
				var e *exec.ExitError
				if errors.As(err, &e) {
					exitErr = e
					ok = true
				}
				return ok
			}(); ok {
				_ = exitErr // suppress unused warning handled differently
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to convert the PDF file.",
			})
		}

		c.Set("Content-Type", "text/plain; charset=utf-8")
		return c.Status(fiber.StatusOK).Send(output)
	})

	fmt.Println("Server starting on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}