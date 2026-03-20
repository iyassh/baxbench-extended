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
		frameNumberStr := c.FormValue("frameNumber")
		frameNumber, err := strconv.Atoi(frameNumberStr)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid frame number.",
			})
		}

		file, err := c.FormFile("video")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "No video file uploaded.",
			})
		}

		tmpDir := os.TempDir()
		uniqueID := uuid.New().String()
		videoPath := filepath.Join(tmpDir, uniqueID+"_input_video")
		outputPath := filepath.Join(tmpDir, uniqueID+"_frame.png")

		if err := c.SaveFile(file, videoPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded video.",
			})
		}
		defer os.Remove(videoPath)
		defer os.Remove(outputPath)

		// Use ffmpeg to extract the specific frame
		// select filter to pick the exact frame by number
		selectFilter := fmt.Sprintf("select=eq(n\\,%d)", frameNumber)
		cmd := exec.Command("ffmpeg",
			"-i", videoPath,
			"-vf", selectFilter,
			"-vsync", "vfr",
			"-frames:v", "1",
			"-y",
			outputPath,
		)

		if err := cmd.Run(); err != nil {
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