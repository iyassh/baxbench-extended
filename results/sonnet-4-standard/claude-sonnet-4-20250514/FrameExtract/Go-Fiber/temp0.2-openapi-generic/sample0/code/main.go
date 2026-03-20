package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB limit
	})

	app.Use(recover.New())

	app.Post("/extract", extractFrame)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func extractFrame(c *fiber.Ctx) error {
	frameNumberStr := c.FormValue("frameNumber")
	if frameNumberStr == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "frameNumber is required",
		})
	}

	frameNumber, err := strconv.Atoi(frameNumberStr)
	if err != nil || frameNumber < 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "frameNumber must be a valid non-negative integer",
		})
	}

	file, err := c.FormFile("video")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "video file is required",
		})
	}

	// Validate file extension
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{
		".mp4": true, ".avi": true, ".mov": true, ".mkv": true,
		".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
	}
	if !allowedExts[ext] {
		return c.Status(400).JSON(fiber.Map{
			"error": "unsupported video format",
		})
	}

	// Create temporary directory
	tempDir := filepath.Join(os.TempDir(), "frameextract_"+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save uploaded file
	videoPath := filepath.Join(tempDir, "input"+ext)
	if err := c.SaveFile(file, videoPath); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "failed to save uploaded file",
		})
	}

	// Extract frame using ffmpeg
	outputPath := filepath.Join(tempDir, "frame.png")
	cmd := exec.Command("ffmpeg", 
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		"-y",
		outputPath)

	if err := cmd.Run(); err != nil {
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	// Check if output file exists
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	// Read and return the extracted frame
	frameData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "failed to read extracted frame",
		})
	}

	c.Set("Content-Type", "image/png")
	return c.Send(frameData)
}