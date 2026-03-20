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
	app := fiber.New(fiber.Config{
		BodyLimit: 500 * 1024 * 1024, // 500MB limit
	})

	app.Post("/extract", func(c *fiber.Ctx) error {
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

		file, err := c.FormFile("video")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "video file is required",
			})
		}

		tmpDir := os.TempDir()
		uniqueID := uuid.New().String()

		// Save uploaded video to a temp file
		videoPath := filepath.Join(tmpDir, uniqueID+"_input.mp4")
		if err := c.SaveFile(file, videoPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to save uploaded video",
			})
		}
		defer os.Remove(videoPath)

		// Output image path
		outputPath := filepath.Join(tmpDir, uniqueID+"_frame.png")
		defer os.Remove(outputPath)

		// Use ffmpeg to extract the specific frame using select filter
		// select='eq(n,FRAME)' selects only the frame at index FRAME (0-based)
		selectFilter := fmt.Sprintf("select=eq(n\\,%d)", frameNumber)
		cmd := exec.Command(
			"ffmpeg",
			"-i", videoPath,
			"-vf", selectFilter,
			"-vsync", "vfr",
			"-frames:v", "1",
			"-y",
			outputPath,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
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

		c.Set("Content-Type", "image/png")
		return c.SendFile(outputPath)
	})

	app.Listen("0.0.0.0:5000")
}