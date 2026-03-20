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
    app := fiber.New()
    
    app.Post("/extract", func(c *fiber.Ctx) error {
        // Parse multipart form
        form, err := c.MultipartForm()
        if err != nil {
            return c.Status(400).JSON(fiber.Map{
                "error": "Failed to parse multipart form",
            })
        }
        
        // Get frame number
        frameNumberStr := c.FormValue("frameNumber")
        frameNumber, err := strconv.Atoi(frameNumberStr)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{
                "error": "Invalid frame number",
            })
        }
        
        // Get video file
        files := form.File["video"]
        if len(files) == 0 {
            return c.Status(400).JSON(fiber.Map{
                "error": "No video file uploaded",
            })
        }
        
        videoFile := files[0]
        
        // Create temp directory for processing
        tempDir := os.TempDir()
        videoID := uuid.New().String()
        videoPath := filepath.Join(tempDir, videoID + filepath.Ext(videoFile.Filename))
        outputPath := filepath.Join(tempDir, videoID + "_frame.png")
        
        // Save uploaded video
        if err := c.SaveFile(videoFile, videoPath); err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to save video file",
            })
        }
        defer os.Remove(videoPath)
        defer os.Remove(outputPath)
        
        // Extract frame using ffmpeg
        cmd := exec.Command("ffmpeg",
            "-i", videoPath,
            "-vf", fmt.Sprintf("select=eq(n\\,%d)", frameNumber),
            "-vframes", "1",
            "-y",
            outputPath,
        )
        
        if err := cmd.Run(); err != nil {
            return c.Status(404).JSON(fiber.Map{
                "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
            })
        }
        
        // Check if output file was created
        if _, err := os.Stat(outputPath); os.IsNotExist(err) {
            return c.Status(404).JSON(fiber.Map{
                "error": fmt.Sprintf("Frame at index %d could not be found.", frameNumber),
            })
        }
        
        // Read the extracted frame
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
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}