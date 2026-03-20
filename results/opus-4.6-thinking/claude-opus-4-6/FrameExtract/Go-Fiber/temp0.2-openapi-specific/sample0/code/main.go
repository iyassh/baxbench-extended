package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100 MB limit to prevent resource exhaustion
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/extract", func(c *fiber.Ctx) error {
		// Parse frame number
		frameNumberStr := c.FormValue("frameNumber")
		if frameNumberStr == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "frameNumber is required",
			})
		}

		frameNumber, err := strconv.Atoi(strings.TrimSpace(frameNumberStr))
		if err != nil || frameNumber < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "frameNumber must be a non-negative integer",
			})
		}

		// Validate videoFileName to prevent path traversal
		videoFileName := c.FormValue("videoFileName")
		if videoFileName != "" {
			// Sanitize: only allow alphanumeric, dots, hyphens, underscores
			safeNameRegex := regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
			if !safeNameRegex.MatchString(videoFileName) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Invalid video file name",
				})
			}
			// Prevent path traversal
			if strings.Contains(videoFileName, "..") || filepath.IsAbs(videoFileName) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Invalid video file name",
				})
			}
		}

		// Get uploaded file
		file, err := c.FormFile("video")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "video file is required",
			})
		}

		// Create a temporary directory for this request
		tmpDir, err := os.MkdirTemp("", "frameextract-")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Generate a unique filename to avoid collisions and path traversal
		uniqueID := uuid.New().String()
		inputPath := filepath.Join(tmpDir, uniqueID+".video")
		outputPath := filepath.Join(tmpDir, uniqueID+".png")

		// Save uploaded file
		if err := c.SaveFile(file, inputPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		// Use ffmpeg to extract the specific frame
		// select='eq(n,FRAME)' selects the frame at index FRAME (0-based)
		// -vframes 1 outputs only one frame
		selectFilter := fmt.Sprintf("select=eq(n\\,%d)", frameNumber)

		cmd := exec.Command(
			"ffmpeg",
			"-i", inputPath,
			"-vf", selectFilter,
			"-vsync", "vfr",
			"-vframes", "1",
			"-y",
			outputPath,
		)

		// Run ffmpeg, capture stderr for debugging but don't expose it
		output, err := cmd.CombinedOutput()
		if err != nil {
			// Log internally but don't expose details
			_ = output
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}

		// Check if the output file exists and has content
		info, err := os.Stat(outputPath)
		if err != nil || info.Size() == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}

		// Read the output file
		imageData, err := os.ReadFile(outputPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		c.Set("Content-Type", "image/png")
		return c.Send(imageData)
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}