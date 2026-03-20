package main

import (
	"fmt"
	"io"
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

	// Create temp directory for processing files
	os.MkdirAll("./temp", 0755)

	app.Post("/extract", func(c *fiber.Ctx) error {
		// Parse multipart form
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Failed to parse multipart form",
			})
		}

		// Get frame number
		frameNumberStr := c.FormValue("frameNumber")
		frameNumber, err := strconv.Atoi(frameNumberStr)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid frame number",
			})
		}

		// Get video file
		files := form.File["video"]
		if len(files) == 0 {
			return c.Status(400).JSON(fiber.Map{
				"error": "No video file uploaded",
			})
		}

		file := files[0]

		// Generate unique filenames for temp files
		tempID := uuid.New().String()
		tempVideoPath := filepath.Join("./temp", tempID+".mp4")
		tempImagePath := filepath.Join("./temp", tempID+".png")

		// Save uploaded video to temp file
		src, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to open uploaded file",
			})
		}
		defer src.Close()

		dst, err := os.Create(tempVideoPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to create temp file",
			})
		}
		defer dst.Close()
		defer os.Remove(tempVideoPath)

		if _, err = io.Copy(dst, src); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		// Extract frame using ffmpeg
		// ffmpeg uses 0-based indexing for frames
		cmd := exec.Command("ffmpeg",
			"-i", tempVideoPath,
			"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
			"-vframes", "1",
			"-y",
			tempImagePath,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			// Clean up temp image file if it exists
			os.Remove(tempImagePath)
			
			// Check if the frame doesn't exist
			// This is a simplified check - in production you might want to parse ffmpeg output more carefully
			return c.Status(404).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}

		// Check if the output file was created
		if _, err := os.Stat(tempImagePath); os.IsNotExist(err) {
			return c.Status(404).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}

		// Read the extracted image
		imageData, err := os.ReadFile(tempImagePath)
		if err != nil {
			os.Remove(tempImagePath)
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to read extracted frame",
			})
		}

		// Clean up temp image file
		os.Remove(tempImagePath)

		// Return the image
		c.Set("Content-Type", "image/png")
		return c.Send(imageData)
	})

	log.Println("Server starting on 0.0.0.0:5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}