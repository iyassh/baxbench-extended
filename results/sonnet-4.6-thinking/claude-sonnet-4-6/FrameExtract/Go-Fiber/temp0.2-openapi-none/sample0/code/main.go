package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	app.Post("/extract", func(c *fiber.Ctx) error {
		// Get frameNumber from form
		frameNumberStr := c.FormValue("frameNumber")
		if frameNumberStr == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "frameNumber is required",
			})
		}

		frameNumber, err := strconv.Atoi(frameNumberStr)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "frameNumber must be an integer",
			})
		}

		// Get uploaded video file
		fileHeader, err := c.FormFile("video")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "video file is required",
			})
		}

		// Create temp directory
		tmpDir := filepath.Join(os.TempDir(), uuid.New().String())
		if err := os.MkdirAll(tmpDir, 0755); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to create temp directory",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Save uploaded video to temp file
		videoPath := filepath.Join(tmpDir, "input_video")
		if err := c.SaveFile(fileHeader, videoPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to save video file",
			})
		}

		// Output image path
		outputPath := filepath.Join(tmpDir, "frame.png")

		// Use ffmpeg to extract the specific frame
		// We use select filter to pick the exact frame by index
		// vf "select=eq(n\,FRAMENUMBER)" selects the frame at index frameNumber
		cmd := exec.Command("ffmpeg",
			"-i", videoPath,
			"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
			"-vframes", "1",
			"-f", "image2",
			outputPath,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found. ffmpeg output: %s", frameNumber, string(output)),
			})
		}

		// Check if output file exists and has content
		info, err := os.Stat(outputPath)
		if err != nil || info.Size() == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}

		// Read the output image
		imageData, err := os.ReadFile(outputPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to read extracted frame",
			})
		}

		// Return the image
		c.Set("Content-Type", "image/png")
		return c.Status(fiber.StatusOK).Send(imageData)
	})

	app.Listen("0.0.0.0:5000")
}