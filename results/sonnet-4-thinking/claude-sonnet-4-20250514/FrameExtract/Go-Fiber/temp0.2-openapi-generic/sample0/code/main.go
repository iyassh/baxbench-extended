package main

import (
    "fmt"
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
    
    app.Listen("0.0.0.0:5000")
}

func extractFrame(c *fiber.Ctx) error {
    // Get form data
    frameNumberStr := c.FormValue("frameNumber")
    
    frameNumber, err := strconv.Atoi(frameNumberStr)
    if err != nil || frameNumber < 0 {
        return c.Status(404).JSON(fiber.Map{
            "error": "Invalid frame number",
        })
    }
    
    // Basic sanity check for frame number
    if frameNumber > 1000000 {
        return c.Status(404).JSON(fiber.Map{
            "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
        })
    }
    
    // Get the uploaded file
    file, err := c.FormFile("video")
    if err != nil {
        return c.Status(404).JSON(fiber.Map{
            "error": "Could not retrieve video file",
        })
    }
    
    // Basic validation - check if it looks like a video file
    filename := strings.ToLower(file.Filename)
    validExtensions := []string{".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv"}
    isValidExtension := false
    for _, ext := range validExtensions {
        if strings.HasSuffix(filename, ext) {
            isValidExtension = true
            break
        }
    }
    if !isValidExtension {
        return c.Status(404).JSON(fiber.Map{
            "error": "Unsupported video format",
        })
    }
    
    // Create unique temporary file names
    id := uuid.New().String()
    tempDir := os.TempDir()
    inputPath := filepath.Join(tempDir, fmt.Sprintf("input_%s%s", id, filepath.Ext(file.Filename)))
    outputPath := filepath.Join(tempDir, fmt.Sprintf("frame_%s.png", id))
    
    // Save uploaded file
    err = c.SaveFile(file, inputPath)
    if err != nil {
        return c.Status(404).JSON(fiber.Map{
            "error": "Could not save video file",
        })
    }
    defer os.Remove(inputPath)
    defer os.Remove(outputPath)
    
    // Run ffmpeg to extract frame
    cmd := exec.Command("ffmpeg", "-nostdin", "-loglevel", "error", "-i", inputPath, "-vf", fmt.Sprintf("select=eq(n,%d)", frameNumber), "-vframes", "1", "-y", outputPath)
    err = cmd.Run()
    if err != nil {
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
    
    // Set content type and send the file
    c.Set("Content-Type", "image/png")
    return c.SendFile(outputPath)
}