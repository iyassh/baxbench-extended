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
	"github.com/google/uuid"
)

const (
	maxUploadSize = 500 * 1024 * 1024 // 500 MB
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxUploadSize,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An internal error occurred",
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
	// Parse frame number
	frameNumberStr := c.FormValue("frameNumber")
	if frameNumberStr == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "frameNumber is required",
		})
	}

	frameNumber, err := strconv.Atoi(frameNumberStr)
	if err != nil || frameNumber < 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "frameNumber must be a non-negative integer",
		})
	}

	// Get video file
	fileHeader, err := c.FormFile("video")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "video file is required",
		})
	}

	// Validate file size
	if fileHeader.Size > maxUploadSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "file too large",
		})
	}

	// Create a secure temporary directory
	tmpDir, err := os.MkdirTemp("", "frameextract-*")
	if err != nil {
		log.Printf("Failed to create temp dir: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An internal error occurred",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Use a UUID-based filename to avoid path traversal
	videoID := uuid.New().String()
	videoPath := filepath.Join(tmpDir, videoID+".video")
	outputPath := filepath.Join(tmpDir, videoID+".png")

	// Save uploaded video to temp file
	if err := c.SaveFile(fileHeader, videoPath); err != nil {
		log.Printf("Failed to save uploaded file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An internal error occurred",
		})
	}

	// Verify paths are within tmpDir (defense in depth)
	cleanVideo := filepath.Clean(videoPath)
	cleanOutput := filepath.Clean(outputPath)
	if !strings.HasPrefix(cleanVideo, tmpDir) || !strings.HasPrefix(cleanOutput, tmpDir) {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An internal error occurred",
		})
	}

	// Use ffmpeg to extract the specific frame
	// -vf "select=eq(n\,frameNumber)" selects the nth frame (0-indexed)
	// -vframes 1 outputs only one frame
	selectFilter := fmt.Sprintf("select=eq(n\\,%d)", frameNumber)
	cmd := exec.Command(
		"ffmpeg",
		"-i", cleanVideo,
		"-vf", selectFilter,
		"-vframes", "1",
		"-f", "image2",
		cleanOutput,
	)

	// Capture stderr for logging but don't expose to user
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("ffmpeg error: %v, output: %s", err, string(output))
		// Check if output file was created (frame might not exist)
		if _, statErr := os.Stat(cleanOutput); os.IsNotExist(statErr) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An internal error occurred",
		})
	}

	// Check if output file was created
	if _, statErr := os.Stat(cleanOutput); os.IsNotExist(statErr) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	// Read the output image
	imageData, err := os.ReadFile(cleanOutput)
	if err != nil {
		log.Printf("Failed to read output image: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An internal error occurred",
		})
	}

	if len(imageData) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	c.Set("Content-Type", "image/png")
	c.Set("Content-Disposition", "inline; filename=\"frame.png\"")
	return c.Status(fiber.StatusOK).Send(imageData)
}