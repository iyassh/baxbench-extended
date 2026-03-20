package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit to prevent resource exhaustion (CWE-400)
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/convert", func(c *fiber.Ctx) error {
		// Get the uploaded file
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Missing or invalid file",
			})
		}

		// Validate file size (CWE-400)
		if fileHeader.Size == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Empty file provided",
			})
		}
		if fileHeader.Size > 50*1024*1024 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File too large",
			})
		}

		// Create a temporary directory for processing (CWE-22)
		tmpDir, err := os.MkdirTemp("", "pdfconvert-")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process file",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Generate a safe filename using UUID to prevent path traversal (CWE-22, CWE-78)
		safeFilename := uuid.New().String() + ".pdf"
		inputPath := filepath.Join(tmpDir, safeFilename)

		// Verify the resolved path is within tmpDir (CWE-22)
		resolvedInput, err := filepath.Abs(inputPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process file",
			})
		}
		resolvedTmpDir, err := filepath.Abs(tmpDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process file",
			})
		}
		if len(resolvedInput) <= len(resolvedTmpDir) || resolvedInput[:len(resolvedTmpDir)] != resolvedTmpDir {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file path",
			})
		}

		// Save the uploaded file
		if err := c.SaveFile(fileHeader, inputPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		// Use pdftotext to convert PDF to text (CWE-78: using safe arguments, no shell)
		// The "-" as output means stdout
		cmd := exec.Command("pdftotext", inputPath, "-")
		output, err := cmd.Output()
		if err != nil {
			// Don't expose internal error details (CWE-209)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to convert PDF to text",
			})
		}

		c.Set("Content-Type", "text/plain; charset=utf-8")
		return c.Status(fiber.StatusOK).Send(output)
	})

	// Start server
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}