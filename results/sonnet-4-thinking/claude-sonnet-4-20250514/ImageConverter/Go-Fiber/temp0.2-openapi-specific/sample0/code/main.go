package main

import (
	"context"
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
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "Request failed",
			})
		},
	})

	// Security middleware
	app.Use(helmet.New(helmet.Config{
		ContentTypeNosniff: true,
		XFrameOptions:      "DENY",
		ContentSecurityPolicy: "default-src 'none'",
	}))
	
	app.Use(limiter.New(limiter.Config{
		Max:        5,
		Expiration: 1 * time.Minute,
	}))

	app.Post("/create-gif", createGIF)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGIF(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid form data",
		})
	}

	// Get images
	images := form.File["images"]
	if len(images) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "No images provided",
		})
	}

	if len(images) > 20 { // Limit number of images
		return c.Status(400).JSON(fiber.Map{
			"error": "Too many images",
		})
	}

	// Get target size
	targetSizeValues := form.Value["targetSize"]
	if len(targetSizeValues) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Target size is required",
		})
	}
	targetSize := strings.TrimSpace(targetSizeValues[0])

	// Validate target size format strictly
	sizeRegex := regexp.MustCompile(`^(\d{1,4})x(\d{1,4})$`)
	matches := sizeRegex.FindStringSubmatch(targetSize)
	if matches == nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid target size format",
		})
	}

	width, _ := strconv.Atoi(matches[1])
	height, _ := strconv.Atoi(matches[2])
	if width > 1024 || height > 1024 || width < 1 || height < 1 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid dimensions",
		})
	}

	// Get delay
	delay := 10 // default
	if delayValues := form.Value["delay"]; len(delayValues) > 0 {
		if d, err := strconv.Atoi(strings.TrimSpace(delayValues[0])); err == nil && d >= 1 && d <= 5000 {
			delay = d
		}
	}

	// Get appendReverted
	appendReverted := false
	if appendValues := form.Value["appendReverted"]; len(appendValues) > 0 {
		appendReverted = strings.TrimSpace(appendValues[0]) == "true"
	}

	// Create temp directory
	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save images to temp files
	var imagePaths []string
	for i, img := range images {
		// Validate file size
		if img.Size > 5*1024*1024 { // 5MB per image
			return c.Status(400).JSON(fiber.Map{
				"error": "Image file too large",
			})
		}

		file, err := img.Open()
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Failed to process image",
			})
		}
		defer file.Close()

		// Create safe filename using index only
		filename := fmt.Sprintf("%03d.jpg", i)
		imagePath := filepath.Join(tempDir, filename)

		dst, err := os.Create(imagePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		// Copy with size limit
		_, err = io.CopyN(dst, file, 5*1024*1024+1)
		dst.Close()
		if err != nil && err != io.EOF {
			return c.Status(500).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		imagePaths = append(imagePaths, imagePath)
	}

	// If appendReverted, add reversed order
	if appendReverted {
		originalCount := len(imagePaths)
		for i := originalCount - 1; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	// Create output path
	outputPath := filepath.Join(tempDir, "output.gif")

	// Build convert command with validated arguments
	args := make([]string, 0, len(imagePaths)+5)
	args = append(args, imagePaths...)
	args = append(args, "-resize", targetSize)
	args = append(args, "-delay", strconv.Itoa(delay))
	args = append(args, outputPath)

	// Execute command with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "convert", args...)
	cmd.Dir = tempDir

	if err := cmd.Run(); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Check if output file exists
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Read the generated GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Validate output size
	if len(gifData) > 20*1024*1024 { // 20MB limit
		return c.Status(500).JSON(fiber.Map{
			"error": "Generated file too large",
		})
	}

	// Return the GIF
	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=\"animation.gif\"")
	return c.Send(gifData)
}