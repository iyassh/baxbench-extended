package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	app.Post("/extract", handleExtractFrame)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleExtractFrame(c *fiber.Ctx) error {
	frameNumberStr := c.FormValue("frameNumber")
	if frameNumberStr == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "frameNumber is required",
		})
	}

	frameNumber, err := strconv.Atoi(frameNumberStr)
	if err != nil || frameNumber < 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "frameNumber must be a non-negative integer",
		})
	}

	file, err := c.FormFile("video")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "video file is required",
		})
	}

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0700)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	videoPath := filepath.Join(tempDir, "input_video")
	err = c.SaveFile(file, videoPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save uploaded video",
		})
	}

	outputPath := filepath.Join(tempDir, "frame.png")

	cmd := exec.Command("ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n,%d)", frameNumber),
		"-vsync", "0",
		"-frames:v", "1",
		outputPath,
	)

	cmd.Run()

	fileInfo, err := os.Stat(outputPath)
	if os.IsNotExist(err) || (err == nil && fileInfo.Size() == 0) {
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	imageData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read extracted frame",
		})
	}

	c.Set("Content-Type", "image/png")
	return c.Send(imageData)
}