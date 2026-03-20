package main

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:             100 * 1024 * 1024, // 100 MB limit
		DisableStartupMessage: false,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// Rate limiting middleware
	app.Use(limiter.New(limiter.Config{
		Max:        20,
		Expiration: 60,
	}))

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

	// Get the uploaded video file
	fileHeader, err := c.FormFile("video")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "video file is required",
		})
	}

	// Validate file size (max 100MB)
	if fileHeader.Size > 100*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "video file too large",
		})
	}

	// Create a secure temporary directory
	tmpDir, err := os.MkdirTemp("", "frameextract-*")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Generate a unique filename for the video to avoid path traversal
	videoID := uuid.New().String()
	videoPath := filepath.Join(tmpDir, videoID+".video")
	outputPath := filepath.Join(tmpDir, videoID+".png")

	// Save the uploaded video to the temp directory
	if err := c.SaveFile(fileHeader, videoPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}

	// Verify the paths are within tmpDir (path traversal protection)
	cleanVideoPath, err := filepath.Abs(videoPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}
	cleanOutputPath, err := filepath.Abs(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}
	cleanTmpDir, err := filepath.Abs(tmpDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}

	if !isSubPath(cleanTmpDir, cleanVideoPath) || !isSubPath(cleanTmpDir, cleanOutputPath) {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}

	// Use ffmpeg to extract the specific frame
	// -vf "select=eq(n\,frameNumber)" selects the frame at the given index
	// -vframes 1 outputs only one frame
	selectFilter := fmt.Sprintf("select=eq(n\\,%d)", frameNumber)
	cmd := exec.Command(
		"ffmpeg",
		"-i", cleanVideoPath,
		"-vf", selectFilter,
		"-vframes", "1",
		"-f", "image2",
		cleanOutputPath,
	)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Check if output file was created
		if _, statErr := os.Stat(cleanOutputPath); os.IsNotExist(statErr) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
	}

	// Check if output file exists and has content
	info, err := os.Stat(cleanOutputPath)
	if err != nil || info.Size() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	// Read the output image
	imageData, err := os.ReadFile(cleanOutputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}

	c.Set("Content-Type", "image/png")
	c.Set("Content-Disposition", "inline; filename=\"frame.png\"")
	return c.Status(fiber.StatusOK).Send(imageData)
}

// isSubPath checks if path is under parent directory
func isSubPath(parent, path string) bool {
	rel, err := filepath.Rel(parent, path)
	if err != nil {
		return false
	}
	// If the relative path starts with "..", it's outside the parent
	if len(rel) >= 2 && rel[:2] == ".." {
		return false
	}
	return true
}