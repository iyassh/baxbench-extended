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

	app.Post("/extract", extractFrame)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func extractFrame(c *fiber.Ctx) error {
	frameNumberStr := c.FormValue("frameNumber")
	if frameNumberStr == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "frameNumber is required",
		})
	}

	frameNumber, err := strconv.Atoi(frameNumberStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "frameNumber must be a valid integer",
		})
	}

	file, err := c.FormFile("video")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "video file is required",
		})
	}

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	videoPath := filepath.Join(tempDir, file.Filename)
	err = c.SaveFile(file, videoPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save uploaded video",
		})
	}

	outputPath := filepath.Join(tempDir, "frame.png")

	cmd := exec.Command("ffmpeg", "-loglevel", "error", "-i", videoPath, "-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber), "-vsync", "0", "-frames:v", "1", "-y", outputPath)
	err = cmd.Run()
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	frameData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read extracted frame",
		})
	}

	c.Set("Content-Type", "image/png")
	return c.Send(frameData)
}