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
    app := fiber.New(fiber.Config{
        BodyLimit: 100 * 1024 * 1024, // 100MB limit
    })

    app.Post("/extract", handleExtract)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleExtract(c *fiber.Ctx) error {
    // Get frame number
    frameNumberStr := c.FormValue("frameNumber")
    frameNumber, err := strconv.Atoi(frameNumberStr)
    if err != nil || frameNumber < 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid frame number",
        })
    }

    // Get video file
    file, err := c.FormFile("video")
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "No video file uploaded",
        })
    }
    
    // Create temporary directory
    tempDir, err := os.MkdirTemp("", "frame-extract-")
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create temporary directory",
        })
    }
    defer os.RemoveAll(tempDir)

    // Generate safe filename
    videoPath := filepath.Join(tempDir, uuid.New().String()+filepath.Ext(file.Filename))
    if err := c.SaveFile(file, videoPath); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to save video file",
        })
    }

    // Output image path
    outputPath := filepath.Join(tempDir, "frame.png")

    // Extract frame using ffmpeg
    // Using select filter to extract specific frame number
    cmd := exec.Command(
        "ffmpeg",
        "-i", videoPath,
        "-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
        "-vframes", "1",
        "-f", "image2",
        "-y",
        outputPath,
    )

    err = cmd.Run()
    if err != nil {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
        })
    }

    // Check if output file was created and has content
    fileInfo, err := os.Stat(outputPath)
    if err != nil || fileInfo.Size() == 0 {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
        })
    }

    // Read the extracted frame
    frameData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to read extracted frame",
        })
    }

    // Return the frame as PNG
    c.Set("Content-Type", "image/png")
    return c.Send(frameData)
}