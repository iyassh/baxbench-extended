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
	"github.com/google/uuid"
)

const (
	maxVideoSize = 100 * 1024 * 1024 // 100MB
	tempDir      = "/tmp/frameextract"
	timeout      = 30 * time.Second
)

func main() {
	// Create temp directory
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit:             maxVideoSize,
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/extract", handleExtract)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleExtract(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid form data",
		})
	}

	// Get frame number
	frameNumberStr := c.FormValue("frameNumber")
	frameNumber, err := strconv.Atoi(frameNumberStr)
	if err != nil || frameNumber < 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid frame number",
		})
	}

	// Get video file
	files := form.File["video"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No video file uploaded",
		})
	}

	file := files[0]
	if file.Size > maxVideoSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Video file too large",
		})
	}

	// Generate unique filenames
	sessionID := uuid.New().String()
	videoPath := filepath.Join(tempDir, sessionID+"_video")
	imagePath := filepath.Join(tempDir, sessionID+"_frame.png")

	// Clean up files after processing
	defer func() {
		os.Remove(videoPath)
		os.Remove(imagePath)
	}()

	// Save uploaded video
	if err := c.SaveFile(file, videoPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save video",
		})
	}

	// Extract frame using ffmpeg
	ctx, cancel := exec.CommandContext(c.Context(), "ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		"-f", "image2",
		"-y",
		imagePath)
	defer cancel()

	// Set timeout
	go func() {
		time.Sleep(timeout)
		cancel()
	}()

	output, err := ctx.CombinedOutput()
	if err != nil {
		// Check if frame exists
		if strings.Contains(string(output), "Output file is empty") || 
		   strings.Contains(string(output), "does not contain any stream") ||
		   ctx.Err() != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to extract frame",
		})
	}

	// Check if image was created
	if _, err := os.Stat(imagePath); os.IsNotExist(err) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	// Read and send image
	imageFile, err := os.Open(imagePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read extracted frame",
		})
	}
	defer imageFile.Close()

	// Get file info for size
	stat, err := imageFile.Stat()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to get frame info",
		})
	}

	// Set response headers
	c.Set("Content-Type", "image/png")
	c.Set("Content-Length", strconv.FormatInt(stat.Size(), 10))

	// Stream the image
	_, err = io.Copy(c.Response().BodyWriter(), imageFile)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to send frame",
		})
	}

	return nil
}