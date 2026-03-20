package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	maxFileSize      = 10 * 1024 * 1024 // 10MB per file
	maxTotalSize     = 50 * 1024 * 1024 // 50MB total
	maxFiles         = 20
	maxDimension     = 2000
	minDimension     = 10
	maxDelay         = 10000
	minDelay         = 10
	tempDirPrefix    = "gif_"
	cleanupInterval  = 5 * time.Minute
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:             maxTotalSize,
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred processing your request",
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

	// Cleanup old temp directories periodically
	go func() {
		for {
			time.Sleep(cleanupInterval)
			cleanupOldTempDirs()
		}
	}()

	app.Post("/create-gif", createGIF)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGIF(c *fiber.Ctx) error {
	// Create unique temp directory
	tempDir := filepath.Join(os.TempDir(), tempDirPrefix+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		log.Printf("Failed to create temp directory: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}
	defer func() {
		if err := os.RemoveAll(tempDir); err != nil {
			log.Printf("Failed to cleanup temp directory: %v", err)
		}
	}()

	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid form data",
		})
	}

	// Get images
	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No images provided",
		})
	}
	if len(files) > maxFiles {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Too many files. Maximum allowed: %d", maxFiles),
		})
	}

	// Get and validate targetSize
	targetSizeValues := form.Value["targetSize"]
	if len(targetSizeValues) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Target size is required",
		})
	}
	targetSize := targetSizeValues[0]
	width, height, err := parseTargetSize(targetSize)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid target size format. Use format: widthxheight (e.g., 500x500)",
		})
	}

	// Get and validate delay
	delay := 10
	if delayValues := form.Value["delay"]; len(delayValues) > 0 {
		parsedDelay, err := strconv.Atoi(delayValues[0])
		if err != nil || parsedDelay < minDelay || parsedDelay > maxDelay {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Invalid delay. Must be between %d and %d milliseconds", minDelay, maxDelay),
			})
		}
		delay = parsedDelay
	}

	// Get appendReverted flag
	appendReverted := false
	if appendRevertedValues := form.Value["appendReverted"]; len(appendRevertedValues) > 0 {
		appendReverted = appendRevertedValues[0] == "true"
	}

	// Save uploaded files
	var imagePaths []string
	totalSize := int64(0)
	for i, file := range files {
		if file.Size > maxFileSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("File too large. Maximum size per file: %d bytes", maxFileSize),
			})
		}
		totalSize += file.Size
		if totalSize > maxTotalSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Total size too large. Maximum total size: %d bytes", maxTotalSize),
			})
		}

		// Validate filename
		if !isValidFilename(file.Filename) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid filename",
			})
		}

		// Save file with sanitized name
		filename := fmt.Sprintf("image_%d_%s", i, sanitizeFilename(file.Filename))
		filePath := filepath.Join(tempDir, filename)
		
		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process uploaded file",
			})
		}
		defer src.Close()

		dst, err := os.Create(filePath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}
		defer dst.Close()

		if _, err := io.Copy(dst, src); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		imagePaths = append(imagePaths, filePath)
	}

	// Prepare output path
	outputPath := filepath.Join(tempDir, "output.gif")

	// Build convert command
	args := []string{"-delay", strconv.Itoa(delay / 10), "-resize", fmt.Sprintf("%dx%d", width, height)}
	
	// Add image paths
	for _, path := range imagePaths {
		args = append(args, path)
	}
	
	// Add reversed images if requested
	if appendReverted {
		for i := len(imagePaths) - 1; i >= 0; i-- {
			args = append(args, imagePaths[i])
		}
	}
	
	args = append(args, "-loop", "0", outputPath)

	// Execute convert command with timeout
	ctx, cancel := exec.CommandContext(c.Context(), "convert", args...)
	defer cancel()
	
	// Set timeout
	go func() {
		time.Sleep(30 * time.Second)
		cancel()
	}()

	output, err := ctx.CombinedOutput()
	if err != nil {
		log.Printf("Convert command failed: %v, output: %s", err, string(output))
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	// Read the generated GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	// Send the GIF
	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}

func parseTargetSize(targetSize string) (int, int, error) {
	parts := strings.Split(strings.ToLower(targetSize), "x")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid format")
	}

	width, err := strconv.Atoi(parts[0])
	if err != nil || width < minDimension || width > maxDimension {
		return 0, 0, fmt.Errorf("invalid width")
	}

	height, err := strconv.Atoi(parts[1])
	if err != nil || height < minDimension || height > maxDimension {
		return 0, 0, fmt.Errorf("invalid height")
	}

	return width, height, nil
}

func isValidFilename(filename string) bool {
	if filename == "" || len(filename) > 255 {
		return false
	}
	
	// Check for path traversal attempts
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		return false
	}
	
	// Check for null bytes
	if strings.Contains(filename, "\x00") {
		return false
	}
	
	return true
}

func sanitizeFilename(filename string) string {
	// Remove any non-alphanumeric characters except dots and underscores
	var result strings.Builder
	for _, r := range filename {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' {
			result.WriteRune(r)
		}
	}
	
	sanitized := result.String()
	if sanitized == "" {
		return "file"
	}
	
	// Limit length
	if len(sanitized) > 100 {
		sanitized = sanitized[:100]
	}
	
	return sanitized
}

func cleanupOldTempDirs() {
	tempDir := os.TempDir()
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		log.Printf("Failed to read temp directory: %v", err)
		return
	}

	cutoff := time.Now().Add(-1 * time.Hour)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		
		if !strings.HasPrefix(entry.Name(), tempDirPrefix) {
			continue
		}
		
		info, err := entry.Info()
		if err != nil {
			continue
		}
		
		if info.ModTime().Before(cutoff) {
			dirPath := filepath.Join(tempDir, entry.Name())
			if err := os.RemoveAll(dirPath); err != nil {
				log.Printf("Failed to remove old temp directory %s: %v", dirPath, err)
			}
		}
	}
}