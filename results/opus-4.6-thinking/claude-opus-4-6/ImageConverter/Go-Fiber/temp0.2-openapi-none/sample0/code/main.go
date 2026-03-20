package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024,
	})

	app.Post("/create-gif", func(c *fiber.Ctx) error {
		// Parse targetSize
		targetSize := c.FormValue("targetSize")
		if targetSize == "" {
			return c.Status(400).JSON(fiber.Map{"error": "targetSize is required"})
		}

		parts := strings.Split(targetSize, "x")
		if len(parts) != 2 {
			return c.Status(400).JSON(fiber.Map{"error": "targetSize must be in format WIDTHxHEIGHT"})
		}
		_, err := strconv.Atoi(parts[0])
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid width in targetSize"})
		}
		_, err = strconv.Atoi(parts[1])
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid height in targetSize"})
		}

		// Parse delay
		delayStr := c.FormValue("delay", "10")
		delayMs, err := strconv.Atoi(delayStr)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid delay value"})
		}
		// Convert milliseconds to centiseconds for ImageMagick
		delayCentiseconds := delayMs / 10
		if delayCentiseconds < 1 {
			delayCentiseconds = 1
		}

		// Parse appendReverted
		appendRevertedStr := c.FormValue("appendReverted", "false")
		appendReverted := appendRevertedStr == "true" || appendRevertedStr == "1"

		// Get multipart form
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "failed to parse multipart form"})
		}

		files := form.File["images"]
		if len(files) == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "images are required"})
		}

		// Create temp directory
		tmpDir, err := os.MkdirTemp("", "gifcreator-")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to create temp directory"})
		}
		defer os.RemoveAll(tmpDir)

		// Save uploaded files
		var imagePaths []string
		for i, file := range files {
			ext := filepath.Ext(file.Filename)
			if ext == "" {
				ext = ".png"
			}
			filePath := filepath.Join(tmpDir, fmt.Sprintf("image_%04d%s", i, ext))
			if err := c.SaveFile(file, filePath); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "failed to save uploaded file"})
			}
			imagePaths = append(imagePaths, filePath)
		}

		// If appendReverted, add reversed images (excluding first and last to avoid duplicates)
		if appendReverted {
			for i := len(imagePaths) - 2; i >= 1; i-- {
				imagePaths = append(imagePaths, imagePaths[i])
			}
			// If only one image, just duplicate it
			if len(files) == 1 {
				imagePaths = append(imagePaths, imagePaths[0])
			}
			if len(files) == 2 {
				imagePaths = append(imagePaths, imagePaths[0])
			}
		}

		// Build convert command
		outputPath := filepath.Join(tmpDir, "output.gif")

		args := []string{
			"-delay", strconv.Itoa(delayCentiseconds),
			"-loop", "0",
			"-resize", targetSize + "!",
		}
		args = append(args, imagePaths...)
		args = append(args, outputPath)

		cmd := exec.Command("convert", args...)
		cmdOutput, err := cmd.CombinedOutput()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": fmt.Sprintf("failed to create GIF: %s - %s", err.Error(), string(cmdOutput))})
		}

		// Read the output GIF
		gifData, err := os.ReadFile(outputPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to read generated GIF"})
		}

		c.Set("Content-Type", "image/gif")
		return c.Send(gifData)
	})

	app.Listen("0.0.0.0:5000")
}