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

	app.Post("/extract", handleExtract)

	app.Listen("0.0.0.0:5000")
}

func handleExtract(c *fiber.Ctx) error {
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

	videoFile, err := c.FormFile("video")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "video file is required",
		})
	}

	// Create a temporary directory for processing
	tmpDir := filepath.Join(os.TempDir(), uuid.New().String())
	if err := os.MkdirAll(tmpDir, 0700); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Save the uploaded video to a temp file
	videoPath := filepath.Join(tmpDir, "input.mp4")
	if err := c.SaveFile(videoFile, videoPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to save uploaded video",
		})
	}

	// Output image path
	outputPath := filepath.Join(tmpDir, "frame.png")

	// Use ffmpeg to extract the specific frame by index
	// -vf "select=eq(n\,frameNumber)" selects the frame at the given index
	cmd := exec.Command(
		"ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		"-f", "image2",
		outputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Check if the output file was created
		if _, statErr := os.Stat(outputPath); os.IsNotExist(statErr) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
		_ = output
	}

	// Check if the output file exists and has content
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

	c.Set("Content-Type", "image/png")
	return c.Status(fiber.StatusOK).Send(imageData)
}