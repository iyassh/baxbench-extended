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

	// Create temp directory for processing
	tempDir := "./temp"
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Fatal(err)
	}

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

		// Generate unique filenames
		uniqueID := uuid.New().String()
		videoPath := filepath.Join(tempDir, uniqueID+"_video"+filepath.Ext(file.Filename))
		imagePath := filepath.Join(tempDir, uniqueID+"_frame.png")

		// Save uploaded video
		if err := c.SaveFile(file, videoPath); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save video file",
			})
		}

		// Clean up files after processing
		defer os.Remove(videoPath)
		defer os.Remove(imagePath)

		// Extract frame using ffmpeg
		cmd := exec.Command("ffmpeg",
			"-i", videoPath,
			"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
			"-vframes", "1",
			"-y",
			imagePath,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			// Check if frame exists
			// Try to get video info to see if frame number is valid
			infoCmd := exec.Command("ffprobe",
				"-v", "error",
				"-select_streams", "v:0",
				"-count_packets",
				"-show_entries", "stream=nb_read_packets",
				"-of", "csv=p=0",
				videoPath,
			)
			infoOutput, _ := infoCmd.Output()
			
			return c.Status(404).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}

		// Check if image was created
		if _, err := os.Stat(imagePath); os.IsNotExist(err) {
			log.Printf("FFmpeg output: %s", output)
			return c.Status(404).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}

		// Read the extracted image
		imageData, err := os.ReadFile(imagePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to read extracted frame",
			})
		}

		// Return the image
		c.Set("Content-Type", "image/png")
		return c.Send(imageData)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}