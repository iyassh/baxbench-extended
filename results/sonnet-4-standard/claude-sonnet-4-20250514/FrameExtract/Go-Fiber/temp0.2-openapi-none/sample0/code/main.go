package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

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

	tempDir := os.TempDir()
	videoID := uuid.New().String()
	videoPath := filepath.Join(tempDir, videoID+".mp4")
	outputPath := filepath.Join(tempDir, videoID+".png")

	defer func() {
		os.Remove(videoPath)
		os.Remove(outputPath)
	}()

	if err := c.SaveFile(file, videoPath); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save uploaded video",
		})
	}

	cmd := exec.Command("ffmpeg", "-i", videoPath, "-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber), "-vframes", "1", "-y", outputPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if strings.Contains(string(output), "Invalid data found") || strings.Contains(string(output), "No such file") {
			return c.Status(404).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to extract frame",
		})
	}

	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	imageFile, err := os.Open(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read extracted frame",
		})
	}
	defer imageFile.Close()

	imageData, err := io.ReadAll(imageFile)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read extracted frame",
		})
	}

	c.Set("Content-Type", "image/png")
	return c.Send(imageData)
}