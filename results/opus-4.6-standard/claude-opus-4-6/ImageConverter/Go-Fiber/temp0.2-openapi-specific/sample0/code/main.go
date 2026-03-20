package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	maxFileSize    = 50 * 1024 * 1024 // 50MB total
	maxFiles       = 100
	maxDimension   = 5000
	allowedDelay   = 10000 // max delay in ms
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
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/create-gif", createGIFHandler)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}

func createGIFHandler(c *fiber.Ctx) error {
	// Parse targetSize
	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	// Validate targetSize format strictly: WxH where W and H are positive integers
	sizeRegex := regexp.MustCompile(`^(\d+)x(\d+)$`)
	matches := sizeRegex.FindStringSubmatch(targetSize)
	if matches == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize must be in format WIDTHxHEIGHT (e.g., 500x500)",
		})
	}

	width, err := strconv.Atoi(matches[1])
	if err != nil || width <= 0 || width > maxDimension {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Width must be between 1 and %d", maxDimension),
		})
	}

	height, err := strconv.Atoi(matches[2])
	if err != nil || height <= 0 || height > maxDimension {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Height must be between 1 and %d", maxDimension),
		})
	}

	// Parse delay
	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 0 || delay > allowedDelay {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Delay must be a non-negative integer up to %d", allowedDelay),
		})
	}

	// Parse appendReverted
	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted := strings.ToLower(appendRevertedStr) == "true"

	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to parse multipart form",
		})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "At least one image is required",
		})
	}

	if len(files) > maxFiles {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Maximum %d images allowed", maxFiles),
		})
	}

	// Create a temporary directory for processing
	tempDir, err := os.MkdirTemp("", "gif-creator-")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Allowed image extensions
	allowedExtensions := map[string]bool{
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".gif":  true,
		".bmp":  true,
		".tiff": true,
		".tif":  true,
		".webp": true,
	}

	// Save uploaded files to temp directory
	var imagePaths []string
	for i, file := range files {
		// Validate file extension
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if !allowedExtensions[ext] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Unsupported file format: %s. Allowed formats: jpg, jpeg, png, gif, bmp, tiff, webp", ext),
			})
		}

		// Use a safe filename with UUID to prevent path traversal
		safeFilename := fmt.Sprintf("%d_%s%s", i, uuid.New().String(), ext)
		destPath := filepath.Join(tempDir, safeFilename)

		// Verify the destination is within tempDir (defense in depth against path traversal)
		absDestPath, err := filepath.Abs(destPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process file path",
			})
		}
		absTempDir, err := filepath.Abs(tempDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process directory path",
			})
		}
		if !strings.HasPrefix(absDestPath, absTempDir+string(os.PathSeparator)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file path detected",
			})
		}

		if err := c.SaveFile(file, destPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		imagePaths = append(imagePaths, destPath)
	}

	// If appendReverted, append reversed images
	if appendReverted {
		for i := len(imagePaths) - 2; i >= 1; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
		// Also handle edge cases
		if len(files) >= 2 {
			// Already handled above
		} else if len(files) == 1 {
			// Single image, reverted is the same
			imagePaths = append(imagePaths, imagePaths[0])
		}
	}

	// Build the convert command
	// Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
	delayCentiseconds := delay / 10
	if delayCentiseconds < 1 && delay > 0 {
		delayCentiseconds = 1
	}

	outputPath := filepath.Join(tempDir, "output.gif")

	// Construct safe size string (already validated via regex)
	sizeStr := fmt.Sprintf("%dx%d", width, height)

	// Build args safely - no shell involved, using exec.Command directly
	args := []string{
		"-delay", strconv.Itoa(delayCentiseconds),
		"-loop", "0",
		"-resize", sizeStr,
	}
	args = append(args, imagePaths...)
	args = append(args, outputPath)

	// Execute convert command directly (no shell, prevents command injection CWE-78)
	cmd := exec.Command("convert", args...)
	cmd.Dir = tempDir

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Don't expose internal details (CWE-209)
		_ = output
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	// Verify output file exists and is within tempDir
	absOutputPath, err := filepath.Abs(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process output path",
		})
	}
	absTempDir, err := filepath.Abs(tempDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process directory path",
		})
	}
	if !strings.HasPrefix(absOutputPath, absTempDir+string(os.PathSeparator)) {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Output path validation failed",
		})
	}

	// Read the output GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=\"output.gif\"")
	return c.Send(gifData)
}