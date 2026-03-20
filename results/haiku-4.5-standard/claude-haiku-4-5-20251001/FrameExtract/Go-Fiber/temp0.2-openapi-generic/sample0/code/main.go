package main

import (
	"fmt"
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
	// Parse form data
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to parse form data",
		})
	}

	// Get frame number
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

	// Get video file
	files := form.File["video"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "video file is required",
		})
	}

	file := files[0]

	// Create temporary directory
	tmpDir := filepath.Join(os.TempDir(), "frameextract-"+uuid.New().String())
	if err := os.MkdirAll(tmpDir, 0700); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded video
	videoPath := filepath.Join(tmpDir, "video.mp4")
	if err := c.SaveFile(file, videoPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save video file",
		})
	}

	// Extract frame using ffmpeg
	outputPath := filepath.Join(tmpDir, "frame.png")
	cmd := exec.Command("ffmpeg",
		"-i", videoPath,
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
		"-vframes", "1",
		"-y",
		outputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Check if frame was not found
		if strings.Contains(string(output), "Output #0") || !fileExists(outputPath) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to extract frame",
		})
	}

	// Check if output file exists
	if !fileExists(outputPath) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
		})
	}

	// Read and return the image
	imageData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read extracted frame",
		})
	}

	c.Set("Content-Type", "image/png")
	return c.Send(imageData)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}