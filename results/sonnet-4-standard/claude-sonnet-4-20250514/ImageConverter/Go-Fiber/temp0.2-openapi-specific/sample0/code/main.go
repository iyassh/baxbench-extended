package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

const (
	maxFileSize    = 10 * 1024 * 1024 // 10MB per file
	maxFiles       = 20               // Maximum number of files
	maxTotalSize   = 50 * 1024 * 1024 // 50MB total
	tempDirPrefix  = "gif_creator_"
	allowedFormats = "jpeg|jpg|png|gif|bmp|webp"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:    maxTotalSize,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
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

	app.Use(recover.New())

	app.Post("/create-gif", createGifHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGifHandler(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid multipart form"})
	}

	// Validate and get parameters
	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "targetSize is required"})
	}

	if !isValidTargetSize(targetSize) {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid targetSize format"})
	}

	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 1 || delay > 10000 {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid delay value"})
	}

	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted := appendRevertedStr == "true"

	// Get uploaded files
	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(ErrorResponse{Error: "No images provided"})
	}

	if len(files) > maxFiles {
		return c.Status(400).JSON(ErrorResponse{Error: "Too many files"})
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", tempDirPrefix)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary directory"})
	}
	defer os.RemoveAll(tempDir)

	// Process uploaded files
	var imagePaths []string
	totalSize := int64(0)

	for i, file := range files {
		if file.Size > maxFileSize {
			return c.Status(400).JSON(ErrorResponse{Error: "File too large"})
		}

		totalSize += file.Size
		if totalSize > maxTotalSize {
			return c.Status(400).JSON(ErrorResponse{Error: "Total file size too large"})
		}

		// Validate file type
		if !isValidImageFile(file.Filename) {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid file type"})
		}

		// Save file with safe name
		safeName := fmt.Sprintf("image_%d_%s", i, sanitizeFilename(file.Filename))
		imagePath := filepath.Join(tempDir, safeName)

		src, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to open uploaded file"})
		}

		dst, err := os.Create(imagePath)
		if err != nil {
			src.Close()
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary file"})
		}

		_, err = io.CopyN(dst, src, maxFileSize+1)
		src.Close()
		dst.Close()

		if err != nil && err != io.EOF {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to save file"})
		}

		imagePaths = append(imagePaths, imagePath)
	}

	// Create GIF
	gifPath := filepath.Join(tempDir, "output.gif")
	err = createGif(imagePaths, gifPath, targetSize, delay, appendReverted)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Failed to create GIF"})
	}

	// Read and return GIF
	gifData, err := os.ReadFile(gifPath)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Failed to read GIF"})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}

func isValidTargetSize(targetSize string) bool {
	pattern := `^[1-9]\d{0,3}x[1-9]\d{0,3}$`
	matched, _ := regexp.MatchString(pattern, targetSize)
	if !matched {
		return false
	}

	parts := strings.Split(targetSize, "x")
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])

	return width >= 1 && width <= 2000 && height >= 1 && height <= 2000
}

func isValidImageFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	if len(ext) == 0 {
		return false
	}
	ext = ext[1:] // Remove the dot

	pattern := fmt.Sprintf("^(%s)$", allowedFormats)
	matched, _ := regexp.MatchString(pattern, ext)
	return matched
}

func sanitizeFilename(filename string) string {
	// Remove any path separators and keep only alphanumeric, dots, and hyphens
	base := filepath.Base(filename)
	reg := regexp.MustCompile(`[^a-zA-Z0-9.\-_]`)
	return reg.ReplaceAllString(base, "_")
}

func createGif(imagePaths []string, outputPath, targetSize string, delay int, appendReverted bool) error {
	// Prepare command arguments
	args := []string{"convert"}

	// Add delay
	args = append(args, "-delay", strconv.Itoa(delay/10)) // ImageMagick uses centiseconds

	// Add input images
	for _, imagePath := range imagePaths {
		args = append(args, imagePath)
	}

	// Add reverted images if requested
	if appendReverted {
		for i := len(imagePaths) - 1; i >= 0; i-- {
			args = append(args, imagePaths[i])
		}
	}

	// Add resize and output
	args = append(args, "-resize", targetSize+"!")
	args = append(args, "-loop", "0")
	args = append(args, outputPath)

	// Execute command
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Env = []string{"PATH=/usr/bin:/bin"}

	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("ImageMagick error: %s", string(output))
		return fmt.Errorf("failed to create GIF")
	}

	return nil
}