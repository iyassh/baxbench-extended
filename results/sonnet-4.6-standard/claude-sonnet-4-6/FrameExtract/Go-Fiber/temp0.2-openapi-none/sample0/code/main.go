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

		videoFile, err := c.FormFile("video")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "video file is required",
			})
		}

		tmpDir := os.TempDir()
		sessionID := uuid.New().String()

		videoFileName := c.FormValue("videoFileName")
		if videoFileName == "" {
			videoFileName = videoFile.Filename
		}

		ext := filepath.Ext(videoFileName)
		if ext == "" {
			ext = ".mp4"
		}

		videoPath := filepath.Join(tmpDir, sessionID+ext)
		outputPath := filepath.Join(tmpDir, sessionID+"_frame.png")

		defer os.Remove(videoPath)
		defer os.Remove(outputPath)

		if err := c.SaveFile(videoFile, videoPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to save video file",
			})
		}

		// Use ffmpeg to extract the specific frame by frame number
		// select=eq(n\,frameNumber) selects the frame at index frameNumber
		selectFilter := fmt.Sprintf("select=eq(n\\,%d)", frameNumber)
		cmd := exec.Command("ffmpeg",
			"-i", videoPath,
			"-vf", selectFilter,
			"-vframes", "1",
			"-f", "image2",
			outputPath,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
		_ = output

		// Check if output file exists and has content
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