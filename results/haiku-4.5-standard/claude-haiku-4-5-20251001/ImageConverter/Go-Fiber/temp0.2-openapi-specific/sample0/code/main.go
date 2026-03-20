package main

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	maxFileSize     = 50 * 1024 * 1024 // 50MB total
	maxFiles        = 100
	tempDirPrefix   = "gif-creator-"
)

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
		return c.Next()
	})

	app.Post("/create-gif", handleCreateGIF)

	app.Listen("0.0.0.0:5000")
}

func handleCreateGIF(c *fiber.Ctx) error {
	// Parse multipart form with size limit
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid form data",
		})
	}

	// Validate and get images
	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No images provided",
		})
	}

	if len(files) > maxFiles {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Too many images",
		})
	}

	// Get and validate targetSize
	targetSize := form.Value["targetSize"]
	if len(targetSize) == 0 || targetSize[0] == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	if !isValidSize(targetSize[0]) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid targetSize format",
		})
	}

	// Get delay (default 10)
	delay := 10
	if len(form.Value["delay"]) > 0 && form.Value["delay"][0] != "" {
		d, err := strconv.Atoi(form.Value["delay"][0])
		if err != nil || d < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid delay value",
			})
		}
		delay = d
	}

	// Get appendReverted (default false)
	appendReverted := false
	if len(form.Value["appendReverted"]) > 0 {
		val := strings.ToLower(form.Value["appendReverted"][0])
		appendReverted = val == "true" || val == "1"
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", tempDirPrefix)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save uploaded images
	imagePaths := []string{}
	totalSize := int64(0)

	for i, file := range files {
		// Check file size
		if file.Size > maxFileSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File too large",
			})
		}

		totalSize += file.Size
		if totalSize > maxFileSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Total file size exceeds limit",
			})
		}

		// Validate filename
		if !isValidFilename(file.Filename) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid filename",
			})
		}

		// Save file with sanitized name
		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process image",
			})
		}
		defer src.Close()

		filename := fmt.Sprintf("image_%03d.tmp", i)
		filepath := filepath.Join(tempDir, filename)

		dst, err := os.Create(filepath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save image",
			})
		}

		_, err = io.Copy(dst, src)
		dst.Close()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save image",
			})
		}

		imagePaths = append(imagePaths, filepath)
	}

	// Create GIF
	outputPath := filepath.Join(tempDir, "output.gif")
	err = createGIF(imagePaths, outputPath, targetSize, delay, appendReverted)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	// Read and return GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read GIF",
		})
	}

	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=output.gif")
	return c.Send(gifData)
}

func createGIF(imagePaths []string, outputPath string, targetSize string, delay int, appendReverted bool) error {
	// Build convert command
	args := []string{"-delay", strconv.Itoa(delay)}

	// Add images
	for _, path := range imagePaths {
		args = append(args, path)
	}

	// Add reverted images if requested
	if appendReverted {
		for i := len(imagePaths) - 1; i >= 0; i-- {
			args = append(args, imagePaths[i])
		}
	}

	// Resize
	args = append(args, "-resize", targetSize+"!")

	// Output
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	err := cmd.Run()
	if err != nil {
		return err
	}

	return nil
}

func isValidSize(size string) bool {
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return false
	}

	for _, part := range parts {
		if part == "" {
			return false
		}
		num, err := strconv.Atoi(part)
		if err != nil || num <= 0 || num > 10000 {
			return false
		}
	}

	return true
}

func isValidFilename(filename string) bool {
	// Prevent directory traversal
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		return false
	}

	// Check if filename is not empty
	if filename == "" {
		return false
	}

	return true
}