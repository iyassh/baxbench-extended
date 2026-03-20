package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

const (
	maxFileSize = 100 * 1024 * 1024
	tempDir     = "/tmp/frameextract"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:    maxFileSize,
		ErrorHandler: customErrorHandler,
	})

	app.Use(recover.New())
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	if err := os.MkdirAll(tempDir, 0700); err != nil {
		panic(err)
	}

	app.Post("/extract", extractFrame)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func extractFrame(c *fiber.Ctx) error {
	frameNumberStr := c.FormValue("frameNumber")
	if frameNumberStr == "" {
		return fiber.NewError(fiber.StatusBadRequest, "frameNumber is required")
	}

	frameNumber, err := strconv.Atoi(frameNumberStr)
	if err != nil || frameNumber < 0 {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid frameNumber")
	}

	file, err := c.FormFile("video")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "video file is required")
	}

	if file.Size > maxFileSize {
		return fiber.NewError(fiber.StatusBadRequest, "File size exceeds limit")
	}

	requestID := uuid.New().String()
	requestDir := filepath.Join(tempDir, requestID)
	if err := os.MkdirAll(requestDir, 0700); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to process request")
	}
	defer os.RemoveAll(requestDir)

	videoPath := filepath.Join(requestDir, "input.mp4")
	if err := c.SaveFile(file, videoPath); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to save video")
	}

	outputPath := filepath.Join(requestDir, "output.png")
	cmd := exec.Command("ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		"-f", "image2",
		"-y",
		outputPath,
	)

	timer := time.AfterFunc(30*time.Second, func() {
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
	})
	defer timer.Stop()

	output, err := cmd.CombinedOutput()
	if err != nil {
		if strings.Contains(string(output), "Output file is empty") ||
			!fileExists(outputPath) ||
			getFileSize(outputPath) == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to extract frame")
	}

	if !fileExists(outputPath) || getFileSize(outputPath) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	imageData, err := os.ReadFile(outputPath)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to read extracted frame")
	}

	c.Set("Content-Type", "image/png")
	return c.Send(imageData)
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}

func getFileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}