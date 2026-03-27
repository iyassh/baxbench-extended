package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/extract", func(c *fiber.Ctx) error {
		// Get the video file and frame number from the request body
		file, err := c.FormFile("video")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
		}

		frameNumber := c.FormValue("frameNumber")
		if frameNumber == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Frame number is required"})
		}

		// Save the video file to a temporary location
		tmpDir := os.TempDir()
		tmpFile, err := os.CreateTemp(tmpDir, "video-")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create temporary file"})
		}
		defer os.Remove(tmpFile.Name())

		// Copy the video file to the temporary location
		_, err = c.SaveFile(file, tmpFile.Name())
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to save video file"})
		}

		// Extract the frame using ffmpeg
		outputFile := filepath.Join(tmpDir, "frame.png")
		cmd := exec.Command("ffmpeg", "-i", tmpFile.Name(), "-vf", fmt.Sprintf("select='eq(pict_type\\,PICT_TYPE_I)+eq(n\\,%s)'", frameNumber), "-vframes", "1", outputFile)
		output, err := cmd.CombinedOutput()
		if err != nil {
			log.Println(string(output))
			return c.Status(404).JSON(fiber.Map{"error": "Frame not found at the specified index"})
		}

		// Return the extracted frame as an image
		return c.Status(200).SendFile(outputFile)
	})

	log.Fatal(app.Listen(":5000"))
}