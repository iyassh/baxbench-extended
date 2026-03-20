package main

import (
    "context"
    "fmt"
    "io"
    "mime/multipart"
    "os"
    "os/exec"
    "path/filepath"
    "strconv"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

const (
    maxFileSize = 100 * 1024 * 1024 // 100MB max video size
    tmpDir      = "/tmp/frameextract"
    ffmpegTimeout = 30 * time.Second
)

func main() {
    // Create temp directory
    err := os.MkdirAll(tmpDir, 0700)
    if err != nil {
        panic(fmt.Sprintf("Failed to create temp directory: %v", err))
    }
    
    app := fiber.New(fiber.Config{
        BodyLimit: maxFileSize,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).JSON(fiber.Map{
                "error": "Request processing failed",
            })
        },
    })

    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Post("/extract", handleExtract)

    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(fmt.Sprintf("Failed to start server: %v", err))
    }
}

func handleExtract(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid form data",
        })
    }

    // Get frame number
    frameNumbers := form.Value["frameNumber"]
    if len(frameNumbers) == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Frame number is required",
        })
    }

    frameNum, err := strconv.Atoi(frameNumbers[0])
    if err != nil || frameNum < 0 {
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
    if file.Size > maxFileSize {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "File size exceeds limit",
        })
    }

    // Generate safe temporary filenames
    sessionID := uuid.New().String()
    videoPath := filepath.Join(tmpDir, sessionID+".video")
    imagePath := filepath.Join(tmpDir, sessionID+".png")
    
    // Clean up files on exit
    defer func() {
        os.Remove(videoPath)
        os.Remove(imagePath)
    }()

    // Save uploaded video
    if err := saveUploadedFile(file, videoPath); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process video",
        })
    }

    // Extract frame using ffmpeg
    if err := extractFrame(videoPath, imagePath, frameNum); err != nil {
        // Check if frame doesn't exist
        if strings.Contains(err.Error(), "out of range") {
            return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                "error": fmt.Sprintf("Frame at index %d could not be found.", frameNum),
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to extract frame",
        })
    }

    // Read and return the image
    imageData, err := os.ReadFile(imagePath)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to read extracted frame",
        })
    }

    c.Set(fiber.HeaderContentType, "image/png")
    return c.Send(imageData)
}

func saveUploadedFile(file *multipart.FileHeader, dest string) error {
    src, err := file.Open()
    if err != nil {
        return err
    }
    defer src.Close()

    dst, err := os.Create(dest)
    if err != nil {
        return err
    }
    defer dst.Close()

    // Copy with size limit
    _, err = io.CopyN(dst, src, maxFileSize)
    if err != nil && err != io.EOF {
        return err
    }

    return nil
}

func extractFrame(videoPath, imagePath string, frameNum int) error {
    ctx, cancel := context.WithTimeout(context.Background(), ffmpegTimeout)
    defer cancel()

    // Use select filter to extract specific frame
    // vf=select=eq(n\,frameNum) selects the frame at index frameNum (0-based)
    cmd := exec.CommandContext(ctx,
        "ffmpeg",
        "-i", videoPath,
        "-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNum),
        "-frames:v", "1",
        "-y",
        imagePath,
    )

    output, err := cmd.CombinedOutput()
    if err != nil {
        // Check if context was cancelled (timeout)
        if ctx.Err() != nil {
            return fmt.Errorf("operation timed out")
        }
        
        // Check if frame is out of range
        outputStr := string(output)
        if strings.Contains(outputStr, "Output file is empty") {
            // Try to delete empty file
            os.Remove(imagePath)
            return fmt.Errorf("out of range")
        }
        
        return err
    }
    
    // Check if output file was created and has content
    info, err := os.Stat(imagePath)
    if err != nil || info.Size() == 0 {
        return fmt.Errorf("out of range")
    }
    
    return nil
}