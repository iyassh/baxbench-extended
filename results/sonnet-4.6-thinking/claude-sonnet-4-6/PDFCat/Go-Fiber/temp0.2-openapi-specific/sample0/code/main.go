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
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		},
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

	app.Listen("0.0.0.0:5000")
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

	// Create a temporary directory for this request
	sessionID := uuid.New().String()
	tmpDir, err := os.MkdirTemp("", "pdfconcat-"+sessionID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded files to temp directory with safe names
	var inputPaths []string
	for i, fileHeader := range files {
		// Use a safe, generated filename - no user input in filename
		safeFilename := fmt.Sprintf("input_%d.pdf", i)
		destPath := filepath.Join(tmpDir, safeFilename)

		// Verify the path is within tmpDir (path traversal protection)
		cleanDest := filepath.Clean(destPath)
		if !isSubPath(tmpDir, cleanDest) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		src, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		data := make([]byte, fileHeader.Size)
		_, err = src.Read(data)
		src.Close()
		if err != nil && err.Error() != "EOF" {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		// Validate PDF magic bytes
		if len(data) < 4 || string(data[:4]) != "%PDF" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		if err := os.WriteFile(cleanDest, data, 0600); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		inputPaths = append(inputPaths, cleanDest)
	}

	// Output file path
	outputPath := filepath.Join(tmpDir, "output.pdf")
	cleanOutput := filepath.Clean(outputPath)
	if !isSubPath(tmpDir, cleanOutput) {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Build pdfunite command with only safe, generated paths
	args := append(inputPaths, cleanOutput)
	cmd := exec.Command("pdfunite", args...)
	// Do not pass any user input directly to the command
	// All paths are generated internally

	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Read output file
	outputData, err := os.ReadFile(cleanOutput)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")
	return c.Status(fiber.StatusOK).Send(outputData)
}

// isSubPath checks if child is within parent directory
func isSubPath(parent, child string) bool {
	parent = filepath.Clean(parent)
	child = filepath.Clean(child)
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	// If rel starts with "..", it's outside the parent
	if len(rel) >= 2 && rel[:2] == ".." {
		return false
	}
	if rel == ".." {
		return false
	}
	return true
}