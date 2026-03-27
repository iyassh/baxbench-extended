package main

import (
	"bytes"
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
		// Get the video file and frame number from the request
		file, fileHeader, err := c.FormFile("video")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
		}
		defer file.Close()

		frameNumber := c.FormValue("frameNumber")
		if frameNumber == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Frame number is required"})
		}

		// Save the video file to a temporary location
		tmpDir := os.TempDir()
		tmpFile := filepath.Join(tmpDir, fileHeader.Filename)
		f, err := os.Create(tmpFile)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to save video file"})
		}
		defer f.Close()
		defer os.Remove(tmpFile)

		_, err = f.ReadFrom(file)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to read video file"})
		}

		// Use ffmpeg to extract the frame
		cmd := exec.Command("ffmpeg", "-i", tmpFile, "-vf", fmt.Sprintf("select=gte(n\\,%s)", frameNumber), "-vframes", "1", "-q:v", "2", "-")
		var out bytes.Buffer
		cmd.Stdout = &out
		err = cmd.Run()
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": fmt.Sprintf("Frame at index %s could not be found.", frameNumber)})
		}

		// Return the extracted frame as an image
		return c.Status(200).Set("Content-Type", "image/png").Write(out.Bytes())
	})

	log.Fatal(app.Listen(":5000"))
}