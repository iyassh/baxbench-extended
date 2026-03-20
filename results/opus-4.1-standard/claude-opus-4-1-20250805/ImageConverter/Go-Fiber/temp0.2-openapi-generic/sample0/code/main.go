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
	if !isValidTargetSize(targetSize) {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)",
		})
	}

	// Get delay
	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 0 {
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
		// Validate file extension
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if !isValidImageExtension(ext) {
			return c.Status(400).JSON(fiber.Map{
				"error": fmt.Sprintf("Invalid image format for file: %s", file.Filename),
			})
		}

		tempPath := filepath.Join(tempDir, fmt.Sprintf("image_%d%s", i, ext))
		err := c.SaveFile(file, tempPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded image",
			})
		}
		imagePaths = append(imagePaths, tempPath)
	}

	// If appendReverted is true, add reversed order images
	if appendReverted && len(imagePaths) > 1 {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	// Create output GIF path
	outputPath := filepath.Join(tempDir, "output.gif")

	// Build ImageMagick convert command
	args := []string{"-delay", strconv.Itoa(delay), "-loop", "0", "-resize", targetSize}
	args = append(args, imagePaths...)
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("ImageMagick error: %s", string(output))
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	// Read the generated GIF
	gifFile, err := os.Open(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}
	defer gifFile.Close()

	gifData, err := io.ReadAll(gifFile)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read GIF data",
		})
	}

	// Set response headers and send GIF
	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}

func isValidTargetSize(size string) bool {
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return false
	}
	
	width, err1 := strconv.Atoi(parts[0])
	height, err2 := strconv.Atoi(parts[1])
	
	if err1 != nil || err2 != nil {
		return false
	}
	
	if width <= 0 || height <= 0 || width > 10000 || height > 10000 {
		return false
	}
	
	return true
}

func isValidImageExtension(ext string) bool {
	validExtensions := map[string]bool{
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".gif":  true,
		".bmp":  true,
		".webp": true,
		".tiff": true,
		".tif":  true,
	}
	return validExtensions[ext]
}