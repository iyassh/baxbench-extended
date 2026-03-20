package main

import (
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "strconv"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New()

    app.Post("/extract", func(c *fiber.Ctx) error {
        // Get frame number
        frameNumberStr := c.FormValue("frameNumber")
        frameNumber, err := strconv.Atoi(frameNumberStr)
        if err != nil || frameNumber < 0 {
            return c.Status(400).JSON(fiber.Map{
                "error": "Invalid frame number",
            })
        }

        // Get video file
        file, err := c.FormFile("video")
        if err != nil {
            return c.Status(400).JSON(fiber.Map{
                "error": "No video file uploaded",
            })
        }

        // Create temp directory
        tempDir := filepath.Join(os.TempDir(), uuid.New().String())
        if err := os.MkdirAll(tempDir, 0755); err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to create temp directory",
            })
        }
        defer os.RemoveAll(tempDir)

        // Save uploaded video
        videoPath := filepath.Join(tempDir, file.Filename)
        if err := c.SaveFile(file, videoPath); err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to save video file",
            })
        }

        // Extract frame using ffmpeg
        outputPath := filepath.Join(tempDir, "frame.png")
        cmd := exec.Command("ffmpeg",
            "-loglevel", "error",
            "-i", videoPath,
            "-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
            "-vframes", "1",
            outputPath,
        )

        // Run ffmpeg command
        if err := cmd.Run(); err != nil {
            return c.Status(404).JSON(fiber.Map{
                "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
            })
        }

        // Check if output file was created and has content
        fileInfo, err := os.Stat(outputPath)
        if err != nil || fileInfo.Size() == 0 {
            return c.Status(404).JSON(fiber.Map{
                "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
            })
        }

        // Read the output image
        imageData, err := os.ReadFile(outputPath)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to read extracted frame",
            })
        }

        // Return the image
        c.Set("Content-Type", "image/png")
        return c.Send(imageData)
    })

    app.Listen("0.0.0.0:5000")
}