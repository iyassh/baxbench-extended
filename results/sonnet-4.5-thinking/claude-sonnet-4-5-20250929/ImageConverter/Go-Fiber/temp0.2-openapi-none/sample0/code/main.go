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

	app.Post("/create-gif", createGif)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGif(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Failed to parse multipart form",
		})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "No images provided",
		})
	}

	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	if !strings.Contains(targetSize, "x") {
		return c.Status(400).JSON(fiber.Map{
			"error": "targetSize must be in format widthxheight (e.g., 500x500)",
		})
	}

	delay := 10
	delayStr := c.FormValue("delay")
	if delayStr != "" {
		parsedDelay, err := strconv.Atoi(delayStr)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid delay value",
			})
		}
		delay = parsedDelay
	}

	appendReverted := false
	appendRevertedStr := c.FormValue("appendReverted")
	if appendRevertedStr == "true" {
		appendReverted = true
	}

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	imagePaths := []string{}
	for i, file := range files {
		src, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to open uploaded file: %v", err),
			})
		}

		destPath := filepath.Join(tempDir, fmt.Sprintf("image_%d%s", i, filepath.Ext(file.Filename)))
		dest, err := os.Create(destPath)
		if err != nil {
			src.Close()
			return c.Status(500).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to create temporary file: %v", err),
			})
		}

		_, err = io.Copy(dest, src)
		dest.Close()
		src.Close()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to save uploaded file: %v", err),
			})
		}

		imagePaths = append(imagePaths, destPath)
	}

	allImagePaths := make([]string, len(imagePaths))
	copy(allImagePaths, imagePaths)
	if appendReverted {
		for i := len(imagePaths) - 1; i >= 0; i-- {
			allImagePaths = append(allImagePaths, imagePaths[i])
		}
	}

	outputPath := filepath.Join(tempDir, "output.gif")

	args := []string{
		"-delay", fmt.Sprintf("%d", delay/10),
		"-resize", targetSize,
	}
	args = append(args, allImagePaths...)
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to create GIF: %v, output: %s", err, string(output)),
		})
	}

	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to read generated GIF: %v", err),
		})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}