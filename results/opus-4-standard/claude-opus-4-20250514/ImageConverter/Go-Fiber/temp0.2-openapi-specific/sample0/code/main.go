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
	maxImageCount    = 20
	maxDimension     = 2000
	minDimension     = 10
	maxDelay         = 10000
	minDelay         = 10
	uploadTimeout    = 30 * time.Second
	processTimeout   = 60 * time.Second
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

	app.Post("/create-gif", createGIF)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGIF(c *fiber.Ctx) error {
	// Set timeout for request processing
	c.Context().SetDeadline(time.Now().Add(processTimeout))

	// Create temporary directory for this request
	tempDir := filepath.Join(os.TempDir(), "gif-creator-"+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		log.Printf("Failed to create temp directory: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}
	defer func() {
		if err := os.RemoveAll(tempDir); err != nil {
			log.Printf("Failed to clean up temp directory: %v", err)
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
	if len(files) > maxImageCount {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Too many images. Maximum allowed: %d", maxImageCount),
		})
	}

	// Get and validate target size
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

	// Get append reverted flag
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
				"error": fmt.Sprintf("File too large. Maximum size per file: %d MB", maxFileSize/(1024*1024)),
			})
		}
		totalSize += file.Size
		if totalSize > maxTotalSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Total file size too large. Maximum total size: %d MB", maxTotalSize/(1024*1024)),
			})
		}

		// Validate file extension
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if !isValidImageExtension(ext) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file type. Supported formats: jpg, jpeg, png, bmp, webp",
			})
		}

		// Save file with sanitized name
		filename := fmt.Sprintf("image_%d%s", i, ext)
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

	// If appendReverted is true, add reversed order images
	if appendReverted && len(imagePaths) > 1 {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	// Create GIF using ImageMagick
	outputPath := filepath.Join(tempDir, "output.gif")
	
	// Build command arguments
	args := []string{
		"-delay", fmt.Sprintf("%d", delay/10), // ImageMagick uses centiseconds
		"-loop", "0",
		"-resize", fmt.Sprintf("%dx%d", width, height),
	}
	args = append(args, imagePaths...)
	args = append(args, outputPath)

	// Execute convert command with timeout
	ctx, cancel := c.Context(), func() {}
	defer cancel()
	
	cmd := exec.CommandContext(ctx, "convert", args...)
	cmd.Dir = tempDir
	
	// Capture stderr for debugging but don't expose to user
	var stderr strings.Builder
	cmd.Stderr = &stderr
	
	if err := cmd.Run(); err != nil {
		log.Printf("ImageMagick error: %v, stderr: %s", err, stderr.String())
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	// Read the output GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	// Send the GIF
	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "inline; filename=\"output.gif\"")
	return c.Send(gifData)
}

func parseTargetSize(size string) (int, int, error) {
	parts := strings.Split(strings.ToLower(size), "x")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid format")
	}

	width, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || width < minDimension || width > maxDimension {
		return 0, 0, fmt.Errorf("invalid width")
	}

	height, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil || height < minDimension || height > maxDimension {
		return 0, 0, fmt.Errorf("invalid height")
	}

	return width, height, nil
}

func isValidImageExtension(ext string) bool {
	validExts := map[string]bool{
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".bmp":  true,
		".webp": true,
	}
	return validExts[ext]
}