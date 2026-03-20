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
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

const (
	maxFileSize   = 100 * 1024 * 1024 // 100MB
	maxFrameNumber = 1000000
	tempDir       = "/tmp/frameextract"
)

func main() {
	// Create temp directory
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		log.Fatal("Failed to create temp directory:", err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Use(recover.New())

	app.Post("/extract", extractFrame)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func extractFrame(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid form data",
		})
	}

	// Get frame number
	frameNumbers := form.Value["frameNumber"]
	if len(frameNumbers) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Frame number is required",
		})
	}

	frameNumber, err := strconv.Atoi(frameNumbers[0])
	if err != nil || frameNumber < 0 || frameNumber > maxFrameNumber {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid frame number",
		})
	}

	// Get video file
	files := form.File["video"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Video file is required",
		})
	}

	file := files[0]
	if file.Size > maxFileSize {
		return c.Status(400).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	// Validate file extension
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{
		".mp4": true, ".avi": true, ".mov": true, ".mkv": true,
		".webm": true, ".flv": true, ".wmv": true,
	}
	if !allowedExts[ext] {
		return c.Status(400).JSON(fiber.Map{
			"error": "Unsupported file format",
		})
	}

	// Generate unique filenames
	sessionID := uuid.New().String()
	inputPath := filepath.Join(tempDir, sessionID+"_input"+ext)
	outputPath := filepath.Join(tempDir, sessionID+"_output.png")

	// Clean up files after processing
	defer func() {
		os.Remove(inputPath)
		os.Remove(outputPath)
	}()

	// Save uploaded file
	src, err := file.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to process file",
		})
	}
	defer src.Close()

	dst, err := os.Create(inputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to process file",
		})
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to process file",
		})
	}

	// Extract frame using ffmpeg
	cmd := exec.Command("ffmpeg",
		"-i", inputPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		"-f", "image2",
		"-y",
		outputPath,
	)

	// Set timeout for ffmpeg command
	done := make(chan error, 1)
	go func() {
		done <- cmd.Run()
	}()

	select {
	case err := <-done:
		if err != nil {
			return c.Status(404).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
	case <-time.After(30 * time.Second):
		cmd.Process.Kill()
		return c.Status(500).JSON(fiber.Map{
			"error": "Processing timeout",
		})
	}

	// Check if output file exists
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	// Read and return the extracted frame
	imageData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read extracted frame",
		})
	}

	c.Set("Content-Type", "image/png")
	return c.Send(imageData)
}