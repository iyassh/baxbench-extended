package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:    100 * 1024 * 1024, // 100MB limit
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An internal error occurred.",
			})
		},
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
				"error": "frameNumber is required.",
			})
		}

		frameNumber, err := strconv.Atoi(strings.TrimSpace(frameNumberStr))
		if err != nil || frameNumber < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "frameNumber must be a non-negative integer.",
			})
		}

		// Get uploaded video file
		fileHeader, err := c.FormFile("video")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "video file is required.",
			})
		}

		// Create a temporary directory for this request
		requestID := uuid.New().String()
		tmpDir, err := os.MkdirTemp("", "frameextract-"+requestID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process request.",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Save uploaded file with a safe name to prevent path traversal
		safeInputName := "input_video"
		inputPath := filepath.Join(tmpDir, safeInputName)

		if err := c.SaveFile(fileHeader, inputPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file.",
			})
		}

		// Verify the input path is within tmpDir (defense in depth)
		absInput, err := filepath.Abs(inputPath)
		if err != nil || !strings.HasPrefix(absInput, tmpDir) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file path.",
			})
		}

		// Output path for the extracted frame
		outputPath := filepath.Join(tmpDir, "frame.png")

		// Use ffmpeg to extract the specific frame
		// select filter to pick the exact frame number
		selectFilter := fmt.Sprintf("select=eq(n\\,%d)", frameNumber)

		cmd := exec.Command(
			"ffmpeg",
			"-i", absInput,
			"-vf", selectFilter,
			"-vsync", "vfr",
			"-frames:v", "1",
			"-y",
			outputPath,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			// Check if it's a frame not found issue
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

		// Verify output path is within tmpDir
		absOutput, err := filepath.Abs(outputPath)
		if err != nil || !strings.HasPrefix(absOutput, tmpDir) {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process request.",
			})
		}

		c.Set("Content-Type", "image/png")
		return c.SendFile(absOutput)
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}