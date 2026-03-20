package main

import (
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
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

	app.Listen(":5000")
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

	delayStr := c.FormValue("delay")
	if delayStr == "" {
		delayStr = "10"
	}
	delay, err := strconv.Atoi(delayStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid delay value",
		})
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

		tempImagePath := filepath.Join(tempDir, fmt.Sprintf("image_%d.png", i))
		tempFile, err := os.Create(tempImagePath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temporary file",
			})
		}
		defer tempFile.Close()

		_, err = io.Copy(tempFile, file)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write temporary file",
			})
		}

		convertedPath := filepath.Join(tempDir, fmt.Sprintf("converted_%d.png", i))
		cmd := exec.Command("convert", tempImagePath, "-resize", targetSize, convertedPath)
		if err := cmd.Run(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to convert image",
			})
		}

		if _, err := os.Stat(convertedPath); err == nil {
			imagePaths = append(imagePaths, convertedPath)
		}
	}

	if len(imagePaths) == 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "No valid images to process",
		})
	}

	if appendReverted {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	delayStr = strconv.Itoa(delay / 10)
	gifPath := filepath.Join(tempDir, "output.gif")

	args := []string{"-delay", delayStr, "-loop", "0"}
	args = append(args, imagePaths...)
	args = append(args, gifPath)

	cmd := exec.Command("convert", args...)
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	gifFile, err := os.Open(gifPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}
	defer gifFile.Close()

	gifData, err := io.ReadAll(gifFile)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read GIF data",
		})
	}

	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=output.gif")
	return c.Send(gifData)
}