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

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB limit
	})

	app.Post("/create-gif", createGIF)

	log.Fatal(app.Listen("0.0.0.0:5000"))
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
	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "No images provided",
		})
	}

	// Get targetSize
	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	// Validate targetSize format
	if !strings.Contains(targetSize, "x") {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid targetSize format. Expected format: widthxheight (e.g., 500x500)",
		})
	}

	// Get delay
	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid delay value",
		})
	}

	// Get appendReverted
	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted, err := strconv.ParseBool(appendRevertedStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid appendReverted value",
		})
	}

	// Create temporary directory for processing
	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save uploaded images to temp directory
	var imagePaths []string
	for i, file := range files {
		tempFile := filepath.Join(tempDir, fmt.Sprintf("image_%d%s", i, filepath.Ext(file.Filename)))
		
		// Open uploaded file
		src, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to open uploaded file",
			})
		}
		defer src.Close()

		// Create destination file
		dst, err := os.Create(tempFile)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to create temporary file",
			})
		}
		defer dst.Close()

		// Copy file content
		_, err = io.Copy(dst, src)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		imagePaths = append(imagePaths, tempFile)
	}

	// If appendReverted is true, add reversed order images
	if appendReverted {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	// Output GIF path
	outputGIF := filepath.Join(tempDir, "output.gif")

	// Build convert command
	args := []string{
		"-delay", fmt.Sprintf("%d", delay/10), // convert uses centiseconds
		"-loop", "0",
		"-resize", targetSize,
	}
	args = append(args, imagePaths...)
	args = append(args, outputGIF)

	// Execute ImageMagick convert command
	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to create GIF: %s", string(output)),
		})
	}

	// Read the generated GIF
	gifData, err := os.ReadFile(outputGIF)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	// Set response headers and send GIF
	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}