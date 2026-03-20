package main

import (
    "fmt"
    "io"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "strconv"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit:        100 * 1024 * 1024, // 100MB limit
        ReadTimeout:      30 * time.Second,
        WriteTimeout:     30 * time.Second,
        IdleTimeout:      60 * time.Second,
        DisableStartupMessage: false,
    })
    
    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
        return c.Next()
    })
    
    app.Post("/extract", handleExtractFrame)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleExtractFrame(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid multipart form data",
        })
    }
    
    // Get frame number
    frameNumberStr := c.FormValue("frameNumber")
    if frameNumberStr == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Frame number is required",
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
            "error": "Video file is required",
        })
    }
    
    file := files[0]
    
    // Validate file size
    if file.Size > 100*1024*1024 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "File too large",
        })
    }
    
    // Create secure temporary directory
    tempDir := filepath.Join(os.TempDir(), uuid.New().String())
    err = os.MkdirAll(tempDir, 0700)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create temporary directory",
        })
    }
    defer os.RemoveAll(tempDir)
    
    // Save video to temp file
    videoPath := filepath.Join(tempDir, "input.mp4")
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
            "error": "Failed to create temporary file",
        })
    }
    defer dst.Close()
    
    _, err = io.Copy(dst, src)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to save video file",
        })
    }
    dst.Close()
    
    // Extract frame using ffmpeg
    outputPath := filepath.Join(tempDir, "frame.png")
    
    cmd := exec.Command("ffmpeg",
        "-i", videoPath,
        "-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
        "-vframes", "1",
        "-f", "image2",
        "-y",
        outputPath,
    )
    
    // Execute with timeout
    done := make(chan error, 1)
    go func() {
        done <- cmd.Run()
    }()
    
    select {
    case err := <-done:
        if err != nil {
            return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
            })
        }
    case <-time.After(10 * time.Second):
        if cmd.Process != nil {
            cmd.Process.Kill()
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Frame extraction timed out",
        })
    }
    
    // Check if frame was extracted
    if _, err := os.Stat(outputPath); os.IsNotExist(err) {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
        })
    }
    
    // Read extracted frame
    frameData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to read extracted frame",
        })
    }
    
    // Return frame as PNG
    c.Set(fiber.HeaderContentType, "image/png")
    return c.Send(frameData)
}