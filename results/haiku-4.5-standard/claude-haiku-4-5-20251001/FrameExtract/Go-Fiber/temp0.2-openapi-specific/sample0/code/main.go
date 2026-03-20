package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

const (
	maxUploadSize = 500 * 1024 * 1024 // 500MB
	tempDir       = "/tmp/frameextract"
)

func init() {
	os.MkdirAll(tempDir, 0700)
}

func extractFrame(videoPath string, frameNumber int) (string, error) {
	outputPath := filepath.Join(tempDir, uuid.New().String()+".png")

	cmd := exec.Command(
		"ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		"-f", "image2",
		outputPath,
	)

	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("frame extraction failed")
	}

	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return "", fmt.Errorf("frame not found")
	}

	return outputPath, nil
}

func handleExtract(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")

	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	frameNumberStr := c.FormValue("frameNumber")
	if frameNumberStr == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing frameNumber parameter",
		})
	}

	frameNumber, err := strconv.Atoi(frameNumberStr)
	if err != nil || frameNumber < 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid frameNumber parameter",
		})
	}

	files := form.File["video"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing video file",
		})
	}

	file := files[0]

	if file.Size > maxUploadSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	videoPath := filepath.Join(tempDir, uuid.New().String())
	if err := c.SaveFile(file, videoPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process upload",
		})
	}

	defer os.Remove(videoPath)

	outputPath, err := extractFrame(videoPath, frameNumber)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	defer os.Remove(outputPath)

	c.Set("Content-Type", "image/png")
	return c.SendFile(outputPath)
}

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxUploadSize + 1024,
	})

	app.Use(recover.New())

	app.Post("/extract", handleExtract)

	app.Listen("0.0.0.0:5000")
}