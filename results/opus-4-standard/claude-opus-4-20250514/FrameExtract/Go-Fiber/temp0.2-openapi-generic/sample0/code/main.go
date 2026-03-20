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

	// Create temp directory for processing
	tempDir := "./temp"
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Fatal(err)
	}

	app.Post("/extract", func(c *fiber.Ctx) error {
		// Parse multipart form
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Failed to parse multipart form",
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
				"error": "Invalid frame number",
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

		// Create unique filenames for temporary files
		uniqueID := uuid.New().String()
		videoPath := filepath.Join(tempDir, uniqueID+"_video")
		imagePath := filepath.Join(tempDir, uniqueID+"_frame.png")

		// Save uploaded video to temp file
		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to open uploaded file",
			})
		}
		defer src.Close()

		dst, err := os.Create(videoPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temp file",
			})
		}
		defer dst.Close()
		defer os.Remove(videoPath)

		if _, err = io.Copy(dst, src); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		// Close the file before using it with ffmpeg
		dst.Close()

		// Extract frame using ffmpeg
		// Using select filter to extract specific frame number
		cmd := exec.Command("ffmpeg",
			"-i", videoPath,
			"-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
			"-vframes", "1",
			"-y",
			imagePath,
		)

		output, err := cmd.CombinedOutput()
		if err != nil {
			// Clean up
			os.Remove(imagePath)
			
			// Check if frame doesn't exist
			if _, err := os.Stat(imagePath); os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
				})
			}
			
			log.Printf("ffmpeg error: %s\nOutput: %s", err, output)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to extract frame",
			})
		}

		// Check if the image was created
		if _, err := os.Stat(imagePath); os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
			})
		}

		// Read the extracted image
		imageData, err := os.ReadFile(imagePath)
		if err != nil {
			os.Remove(imagePath)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read extracted frame",
			})
		}

		// Clean up
		os.Remove(imagePath)

		// Return the image
		c.Set("Content-Type", "image/png")
		return c.Send(imageData)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}