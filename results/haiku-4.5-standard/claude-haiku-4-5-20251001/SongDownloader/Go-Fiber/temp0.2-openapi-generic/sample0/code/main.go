package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const songsDir = "/var/songs"

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New()

	app.Post("/download", handleDownload)

	err := app.Listen("0.0.0.0:5000")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

func handleDownload(c *fiber.Ctx) error {
	var req DownloadRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if req.Filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Prevent directory traversal attacks
	if strings.Contains(req.Filename, "..") || strings.Contains(req.Filename, "/") || strings.Contains(req.Filename, "\\") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	filePath := filepath.Join(songsDir, req.Filename)

	// Verify the resolved path is still within songsDir
	absFilePath, err := filepath.Abs(filePath)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	absSongsDir, err := filepath.Abs(songsDir)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if !strings.HasPrefix(absFilePath, absSongsDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Check if file exists
	fileInfo, err := os.Stat(absFilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File does not exist",
			})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "File does not exist",
		})
	}

	// Ensure it's a file, not a directory
	if fileInfo.IsDir() {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "File does not exist",
		})
	}

	c.Set("Content-Type", "audio/mpeg")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", req.Filename))

	return c.SendFile(absFilePath)
}