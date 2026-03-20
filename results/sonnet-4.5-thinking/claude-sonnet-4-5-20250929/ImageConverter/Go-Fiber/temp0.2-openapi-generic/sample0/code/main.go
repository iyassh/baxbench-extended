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
		BodyLimit: 100 * 1024 * 1024,
	})

	app.Post("/create-gif", createGifHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGifHandler(c *fiber.Ctx) error {
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

	if len(files) > 100 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Too many images, maximum is 100",
		})
	}

	targetSizeStr := c.FormValue("targetSize")
	if targetSizeStr == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	parts := strings.Split(targetSizeStr, "x")
	if len(parts) != 2 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid targetSize format, expected widthxheight",
		})
	}
	width, err := strconv.Atoi(parts[0])
	if err != nil || width <= 0 || width > 5000 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid width in targetSize (must be 1-5000)",
		})
	}
	height, err := strconv.Atoi(parts[1])
	if err != nil || height <= 0 || height > 5000 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid height in targetSize (must be 1-5000)",
		})
	}

	targetSize := fmt.Sprintf("%dx%d", width, height)

	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid delay value",
		})
	}

	appendReverted := c.FormValue("appendReverted", "false") == "true"

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	var inputPaths []string
	for i, file := range files {
		src, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to open uploaded file",
			})
		}

		destPath := filepath.Join(tempDir, fmt.Sprintf("input_%d", i))
		dst, err := os.Create(destPath)
		if err != nil {
			src.Close()
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to create destination file",
			})
		}

		_, err = io.Copy(dst, src)
		src.Close()
		dst.Close()

		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		inputPaths = append(inputPaths, destPath)
	}

	if appendReverted {
		for i := len(inputPaths) - 1; i >= 0; i-- {
			inputPaths = append(inputPaths, inputPaths[i])
		}
	}

	outputPath := filepath.Join(tempDir, "output.gif")

	delayCs := delay / 10
	if delayCs < 1 {
		delayCs = 1
	}

	args := []string{
		"-delay", strconv.Itoa(delayCs),
		"-loop", "0",
		"-resize", targetSize,
	}
	args = append(args, inputPaths...)
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to create GIF: %s", string(output)),
		})
	}

	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}