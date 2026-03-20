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
	maxVideoSize = 100 * 1024 * 1024 // 100MB limit
	tempDir      = "/tmp/frameextract"
	timeout      = 30 * time.Second
)

func main() {
	// Create temp directory if it doesn't exist
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
	if frameNumberStr == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Frame number is required",
		})
	}

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
			"error": "Video file is required",
		})
	}

	file := files[0]
	
	// Validate file size
	if file.Size > maxVideoSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Video file too large",
		})
	}

	// Generate unique filenames
	uniqueID := uuid.New().String()
	videoPath := filepath.Join(tempDir, uniqueID+"_video")
	imagePath := filepath.Join(tempDir, uniqueID+"_frame.png")

	// Clean up files after processing
	defer func() {
		os.Remove(videoPath)
		os.Remove(imagePath)
	}()

	// Save uploaded video to temp file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process video",
		})
	}
	defer src.Close()

	dst, err := os.OpenFile(videoPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process video",
		})
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process video",
		})
	}

	// Extract frame using ffmpeg with timeout
	ctx, cancel := exec.CommandContext(c.Context(), "ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		"-f", "image2",
		"-y",
		imagePath)
	
	// Set timeout
	time.AfterFunc(timeout, cancel)
	
	// Capture stderr but don't expose it
	var stderr strings.Builder
	ctx.Stderr = &stderr
	
	if err := ctx.Run(); err != nil {
		// Check if the frame was actually extracted
		if _, statErr := os.Stat(imagePath); os.IsNotExist(statErr) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to extract frame",
		})
	}

	// Check if image was created
	imageData, err := os.ReadFile(imagePath)
	if err != nil || len(imageData) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	// Return the image
	c.Set("Content-Type", "image/png")
	return c.Send(imageData)
}