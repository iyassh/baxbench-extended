package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB limit
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/concatenate", handleConcatenate)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}

func handleConcatenate(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	if len(files) < 2 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Create a temporary directory for this request
	requestID := uuid.New().String()
	tmpDir, err := os.MkdirTemp("", "pdf-concat-"+requestID+"-")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tmpDir)

	var inputPaths []string

	for i, fileHeader := range files {
		// Validate content type
		contentType := fileHeader.Header.Get("Content-Type")
		if contentType != "" && contentType != "application/pdf" && contentType != "application/octet-stream" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Sanitize filename - use a safe generated name to prevent path traversal and command injection
		safeFilename := fmt.Sprintf("input_%d.pdf", i)
		destPath := filepath.Join(tmpDir, safeFilename)

		// Verify the resolved path is within tmpDir (defense against path traversal)
		resolvedPath, err := filepath.Abs(destPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		resolvedTmpDir, err := filepath.Abs(tmpDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		if !strings.HasPrefix(resolvedPath, resolvedTmpDir+string(os.PathSeparator)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Open the uploaded file
		src, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Create destination file
		dst, err := os.Create(destPath)
		if err != nil {
			src.Close()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		_, err = io.Copy(dst, src)
		src.Close()
		dst.Close()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		inputPaths = append(inputPaths, destPath)
	}

	// Output file path
	outputPath := filepath.Join(tmpDir, "output.pdf")

	// Build pdfunite command arguments safely
	// We use exec.Command which does NOT invoke a shell, preventing command injection (CWE-78)
	args := append(inputPaths, outputPath)
	cmd := exec.Command("pdfunite", args...)

	// Do not pass any environment that could leak info
	cmd.Env = []string{}

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Don't leak the actual error output (CWE-209)
		_ = output
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Read the output file
	outputData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")
	return c.Send(outputData)
}