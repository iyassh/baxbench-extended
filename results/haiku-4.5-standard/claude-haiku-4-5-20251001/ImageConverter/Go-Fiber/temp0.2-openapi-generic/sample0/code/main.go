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
)

func main() {
	app := fiber.New()

	app.Post("/create-gif", handleCreateGIF)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleCreateGIF(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to parse multipart form",
		})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No images provided",
		})
	}

	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	if !isValidSize(targetSize) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)",
		})
	}

	delayStr := c.FormValue("delay")
	delay := 10
	if delayStr != "" {
		parsedDelay, err := strconv.Atoi(delayStr)
		if err != nil || parsedDelay < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid delay value. Must be a non-negative integer",
			})
		}
		delay = parsedDelay
	}

	appendReverted := c.FormValue("appendReverted") == "true"

	tempDir, err := os.MkdirTemp("", "gif-creator-")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	imagePaths := []string{}
	for i, fileHeader := range files {
		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to open uploaded file",
			})
		}
		defer file.Close()

		tempImagePath := filepath.Join(tempDir, fmt.Sprintf("image_%03d.png", i))
		tempFile, err := os.Create(tempImagePath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temporary image file",
			})
		}
		defer tempFile.Close()

		_, err = io.Copy(tempFile, file)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write image file",
			})
		}

		imagePaths = append(imagePaths, tempImagePath)
	}

	if appendReverted {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	outputPath := filepath.Join(tempDir, "output.gif")

	convertArgs := []string{
		"-delay", strconv.Itoa(delay / 10),
		"-resize", targetSize + "!",
		"-background", "white",
		"-alpha", "remove",
	}
	convertArgs = append(convertArgs, imagePaths...)
	convertArgs = append(convertArgs, outputPath)

	cmd := exec.Command("convert", convertArgs...)
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=output.gif")
	return c.Send(gifData)
}

func isValidSize(size string) bool {
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return false
	}

	for _, part := range parts {
		if part == "" {
			return false
		}
		num, err := strconv.Atoi(part)
		if err != nil || num <= 0 {
			return false
		}
	}

	return true
}