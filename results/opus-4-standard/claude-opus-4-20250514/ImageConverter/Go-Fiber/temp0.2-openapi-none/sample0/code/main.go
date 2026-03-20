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
	app := fiber.New()

	app.Post("/create-gif", func(c *fiber.Ctx) error {
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
		sizeParts := strings.Split(targetSize, "x")
		if len(sizeParts) != 2 {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid targetSize format. Expected format: widthxheight",
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
		for i, file := range files {
			filename := fmt.Sprintf("image_%d%s", i, filepath.Ext(file.Filename))
			path := filepath.Join(tempDir, filename)
			
			if err := c.SaveFile(file, path); err != nil {
				return c.Status(500).JSON(fiber.Map{
					"error": "Failed to save uploaded image",
				})
			}
			imagePaths = append(imagePaths, path)
		}

		// If appendReverted is true, add reversed order images
		if appendReverted {
			for i := len(imagePaths) - 2; i >= 0; i-- {
				imagePaths = append(imagePaths, imagePaths[i])
			}
		}

		// Create output GIF path
		outputPath := filepath.Join(tempDir, "output.gif")

		// Build convert command
		args := []string{"-delay", strconv.Itoa(delay), "-resize", targetSize}
		args = append(args, imagePaths...)
		args = append(args, "-loop", "0", outputPath)

		// Execute convert command
		cmd := exec.Command("convert", args...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			log.Printf("Convert command failed: %s", string(output))
			return c.Status(500).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to create GIF: %s", err.Error()),
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

		// Get file info for content length
		fileInfo, err := gifFile.Stat()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to get GIF file info",
			})
		}

		// Set response headers
		c.Set("Content-Type", "image/gif")
		c.Set("Content-Length", strconv.FormatInt(fileInfo.Size(), 10))

		// Stream the GIF file
		_, err = io.Copy(c.Response().BodyWriter(), gifFile)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to send GIF",
			})
		}

		return nil
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}