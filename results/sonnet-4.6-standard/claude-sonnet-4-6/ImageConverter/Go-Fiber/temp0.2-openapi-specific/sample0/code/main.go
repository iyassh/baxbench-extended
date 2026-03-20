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
	maxFileSize    = 10 * 1024 * 1024 // 10MB per file
	maxTotalSize   = 50 * 1024 * 1024 // 50MB total
	maxImages      = 50
	maxDelay       = 10000
)

var targetSizeRegex = regexp.MustCompile(`^\d{1,5}x\d{1,5}$`)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxTotalSize,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/create-gif", createGIFHandler)

	app.Listen("0.0.0.0:5000")
}

func createGIFHandler(c *fiber.Ctx) error {
	// Parse targetSize
	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "targetSize is required"})
	}

	// Validate targetSize format strictly (e.g., 500x500)
	if !targetSizeRegex.MatchString(targetSize) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "targetSize must be in format WxH (e.g., 500x500)"})
	}

	// Parse delay
	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 0 || delay > maxDelay {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "delay must be a non-negative integer up to 10000"})
	}

	// Parse appendReverted
	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted := strings.ToLower(appendRevertedStr) == "true"

	// Parse images
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to parse multipart form"})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "At least one image is required"})
	}

	if len(files) > maxImages {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": fmt.Sprintf("Too many images, maximum is %d", maxImages)})
	}

	// Create a temporary directory for processing
	tmpDir, err := os.MkdirTemp("", "gifcreator-*")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create temporary directory"})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded images to temp directory
	var imagePaths []string
	for i, fileHeader := range files {
		if fileHeader.Size > maxFileSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": fmt.Sprintf("File %d exceeds maximum size of 10MB", i+1)})
		}

		// Generate a safe filename using UUID
		safeFilename := fmt.Sprintf("%d_%s.img", i, uuid.New().String())
		destPath := filepath.Join(tmpDir, safeFilename)

		// Ensure the path is within tmpDir (path traversal prevention)
		if !strings.HasPrefix(filepath.Clean(destPath), filepath.Clean(tmpDir)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid file path"})
		}

		if err := c.SaveFile(fileHeader, destPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save uploaded file"})
		}

		imagePaths = append(imagePaths, destPath)
	}

	// Output GIF path
	outputGIF := filepath.Join(tmpDir, "output.gif")

	// Build ImageMagick convert command arguments safely
	// We pass each argument as a separate element to avoid shell injection
	args := []string{
		"-delay", strconv.Itoa(delay),
		"-resize", targetSize,
		"-loop", "0",
	}

	if appendReverted {
		// Build list: original images + reversed images
		allImages := make([]string, 0, len(imagePaths)*2)
		allImages = append(allImages, imagePaths...)
		// Append reversed order
		for i := len(imagePaths) - 1; i >= 0; i-- {
			allImages = append(allImages, imagePaths[i])
		}
		args = append(args, allImages...)
	} else {
		args = append(args, imagePaths...)
	}

	args = append(args, outputGIF)

	// Execute convert command - no shell involved, arguments passed directly
	cmd := exec.Command("convert", args...)
	cmd.Dir = tmpDir

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Log internally but don't expose details to client
		_ = output
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create GIF"})
	}

	// Read the output GIF
	gifData, err := os.ReadFile(outputGIF)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to read generated GIF"})
	}

	// Send the GIF back
	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=\"output.gif\"")
	return c.Status(fiber.StatusOK).Send(gifData)
}