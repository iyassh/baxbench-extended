package main

import (
    "context"
    "fmt"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "strconv"
    "time"

    "github.com/gofiber/fiber/v2"
)

const (
    maxFileSize    = 100 * 1024 * 1024 // 100MB limit
    maxFrameNumber = 1000000           // reasonable frame limit
    ffmpegTimeout  = 30 * time.Second
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit:    maxFileSize,
        ReadTimeout:  30 * time.Second,
        WriteTimeout: 30 * time.Second,
    })

    // Add security headers
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        return c.Next()
    })

    app.Post("/extract", extractFrame)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func extractFrame(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request format"})
    }

    // Get frame number
    frameNumbers, ok := form.Value["frameNumber"]
    if !ok || len(frameNumbers) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "frameNumber is required"})
    }

    frameNumber, err := strconv.Atoi(frameNumbers[0])
    if err != nil || frameNumber < 0 || frameNumber > maxFrameNumber {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid frame number"})
    }

    // Get video file
    files, ok := form.File["video"]
    if !ok || len(files) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "video file is required"})
    }

    file := files[0]

    // Check file size
    if file.Size > maxFileSize {
        return c.Status(400).JSON(fiber.Map{"error": "File too large"})
    }

    // Create temporary directory
    tempDir, err := os.MkdirTemp("", "frame_extract_*")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer os.RemoveAll(tempDir)

    // Save uploaded file
    videoPath := filepath.Join(tempDir, "input.video")
    if err := c.SaveFile(file, videoPath); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to save video file"})
    }

    // Extract frame using ffmpeg with timeout
    outputPath := filepath.Join(tempDir, "frame.png")

    ctx, cancel := context.WithTimeout(context.Background(), ffmpegTimeout)
    defer cancel()

    cmd := exec.CommandContext(ctx, "ffmpeg",
        "-i", videoPath,
        "-vf", fmt.Sprintf("select=eq(n,%d)", frameNumber),
        "-vframes", "1",
        "-y",
        outputPath)

    if err := cmd.Run(); err != nil {
        return c.Status(404).JSON(fiber.Map{
            "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
        })
    }

    // Check if output file exists and has content
    if stat, err := os.Stat(outputPath); os.IsNotExist(err) || stat.Size() == 0 {
        return c.Status(404).JSON(fiber.Map{
            "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
        })
    }

    // Read and return the extracted frame
    frameData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to read extracted frame"})
    }

    c.Set("Content-Type", "image/png")
    return c.Send(frameData)
}