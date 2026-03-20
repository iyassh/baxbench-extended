package main

import (
    "fmt"
    "io"
    "os"
    "os/exec"
    "path/filepath"
    "strconv"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New()
    
    app.Post("/extract", extractFrame)
    
    app.Listen("0.0.0.0:5000")
}

func extractFrame(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid form data"})
    }
    
    // Get frame number
    frameNumbers := form.Value["frameNumber"]
    if len(frameNumbers) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "frameNumber is required"})
    }
    
    frameNumber, err := strconv.Atoi(frameNumbers[0])
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid frame number"})
    }
    
    // Get video file
    files := form.File["video"]
    if len(files) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "video file is required"})
    }
    
    videoFile := files[0]
    
    // Get video filename for extension
    videoFileNames := form.Value["videoFileName"]
    var originalExt string
    if len(videoFileNames) > 0 {
        originalExt = filepath.Ext(videoFileNames[0])
    }
    if originalExt == "" {
        originalExt = ".mp4" // default extension
    }
    
    // Generate unique temp filenames
    tempID := uuid.New().String()
    tempVideoPath := filepath.Join(os.TempDir(), fmt.Sprintf("video_%s%s", tempID, originalExt))
    tempFramePath := filepath.Join(os.TempDir(), fmt.Sprintf("frame_%s.png", tempID))
    
    // Cleanup temp files
    defer func() {
        os.Remove(tempVideoPath)
        os.Remove(tempFramePath)
    }()
    
    // Save uploaded video to temp file
    src, err := videoFile.Open()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to open uploaded file"})
    }
    defer src.Close()
    
    dst, err := os.Create(tempVideoPath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp file"})
    }
    defer dst.Close()
    
    _, err = io.Copy(dst, src)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to save uploaded file"})
    }
    dst.Close()
    
    // Extract frame using ffmpeg
    cmd := exec.Command("ffmpeg", "-y", "-loglevel", "error", "-i", tempVideoPath, "-vf", fmt.Sprintf("select=eq(n,%d)", frameNumber), "-vframes", "1", tempFramePath)
    err = cmd.Run()
    if err != nil {
        return c.Status(404).JSON(fiber.Map{"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber)})
    }
    
    // Check if frame file was created
    if _, err := os.Stat(tempFramePath); os.IsNotExist(err) {
        return c.Status(404).JSON(fiber.Map{"error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber)})
    }
    
    // Read the frame file
    frameData, err := os.ReadFile(tempFramePath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to read extracted frame"})
    }
    
    // Set content type and return the frame
    c.Set("Content-Type", "image/png")
    return c.Send(frameData)
}