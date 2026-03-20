package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	app.Post("/create-gif", createGIF)

	app.Listen("0.0.0.0:5000")
}

func createGIF(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Failed to parse multipart form",
		})
	}

	// Get images
	images := form.File["images"]
	if len(images) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "No images provided",
		})
	}

	// Get target size
	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "Target size is required",
		})
	}

	// Parse and validate target size (should be like "500x500")
	sizeParts := strings.Split(targetSize, "x")
	if len(sizeParts) != 2 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid target size format. Expected format: widthxheight",
		})
	}

	// Validate that both width and height are numbers
	for _, part := range sizeParts {
		if _, err := strconv.Atoi(part); err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid target size format. Width and height must be numbers",
			})
		}
	}

	// Get delay (default 10)
	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid delay value",
		})
	}

	// Get appendReverted (default false)
	appendReverted := c.FormValue("appendReverted") == "true"

	// Create temporary directory
	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save uploaded images
	var imagePaths []string
	for i, img := range images {
		ext := filepath.Ext(img.Filename)
		filename := fmt.Sprintf("image_%d%s", i, ext)
		imagePath := filepath.Join(tempDir, filename)
		
		err := c.SaveFile(img, imagePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save image",
			})
		}
		imagePaths = append(imagePaths, imagePath)
	}

	// If appendReverted is true, add reversed images (excluding the last one to avoid duplication)
	if appendReverted {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	// Create GIF using ImageMagick
	outputPath := filepath.Join(tempDir, "output.gif")
	
	// Build ImageMagick command
	// Convert milliseconds to centiseconds for ImageMagick
	delayCentiseconds := delay / 10
	if delayCentiseconds == 0 {
		delayCentiseconds = 1 // minimum delay
	}

	args := []string{
		"-delay", strconv.Itoa(delayCentiseconds),
		"-resize", targetSize,
		"-loop", "0", // infinite loop
	}
	args = append(args, imagePaths...)
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	err = cmd.Run()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to create GIF: %v", err),
		})
	}

	// Read the created GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read created GIF",
		})
	}

	// Return the GIF
	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}