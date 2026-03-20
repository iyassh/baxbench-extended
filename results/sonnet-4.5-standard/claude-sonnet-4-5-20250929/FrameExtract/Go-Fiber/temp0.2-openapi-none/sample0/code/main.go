<CODE>
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

	app.Post("/extract", handleExtract)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleExtract(c *fiber.Ctx) error {
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

	tempDir := os.TempDir()
	videoID := uuid.New().String()
	videoPath := filepath.Join(tempDir, videoID+".mp4")
	outputPath := filepath.Join(tempDir, videoID+".png")

	defer os.Remove(videoPath)
	defer os.Remove(outputPath)

	if err := c.SaveFile(file, videoPath); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save video file",
		})
	}

	cmd := exec.Command("ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		outputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		log.Printf("ffmpeg output: %s", string(output))
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	return c.SendFile(outputPath)
}
</CODE>