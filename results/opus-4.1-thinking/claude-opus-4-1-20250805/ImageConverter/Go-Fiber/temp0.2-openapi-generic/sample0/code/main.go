package main

import (
    "fmt"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "strconv"
    "strings"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: 100 * 1024 * 1024, // 100 MB limit for uploads
    })
    
    app.Post("/create-gif", createGIFHandler)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGIFHandler(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Failed to parse multipart form",
        })
    }
    
    // Get images
    images := form.File["images"]
    if len(images) == 0 {
        return c.Status(400).JSON(fiber.Map{
            "error": "No images provided",
        })
    }
    
    // Get targetSize
    targetSize := c.FormValue("targetSize")
    if targetSize == "" {
        return c.Status(400).JSON(fiber.Map{
            "error": "targetSize is required",
        })
    }
    
    // Validate targetSize format
    if !isValidSize(targetSize) {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)",
        })
    }
    
    // Get delay (default 10)
    delayStr := c.FormValue("delay", "10")
    delay, err := strconv.Atoi(delayStr)
    if err != nil || delay <= 0 {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid delay value",
        })
    }
    
    // Get appendReverted (default false)
    appendRevertedStr := c.FormValue("appendReverted", "false")
    appendReverted, err := strconv.ParseBool(appendRevertedStr)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid appendReverted value",
        })
    }
    
    // Create temporary directory for processing
    tempDir, err := os.MkdirTemp("", "gif_creator_")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to create temporary directory",
        })
    }
    defer os.RemoveAll(tempDir) // Clean up temp directory
    
    // Save uploaded images to temp directory
    imagePaths := []string{}
    for i, file := range images {
        // Validate file
        if file.Size > 10*1024*1024 { // 10MB per image limit
            return c.Status(400).JSON(fiber.Map{
                "error": "Image file too large (max 10MB per image)",
            })
        }
        
        // Generate safe filename
        ext := filepath.Ext(file.Filename)
        if ext == "" {
            ext = ".jpg"
        }
        safeName := fmt.Sprintf("image_%d_%s%s", i, uuid.New().String(), ext)
        destPath := filepath.Join(tempDir, safeName)
        
        // Save file
        if err := c.SaveFile(file, destPath); err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": fmt.Sprintf("Failed to save image %d", i+1),
            })
        }
        
        imagePaths = append(imagePaths, destPath)
    }
    
    // Create GIF
    outputPath := filepath.Join(tempDir, "output.gif")
    
    // Build convert command arguments
    args := []string{}
    
    // Add delay (convert uses centiseconds, so divide by 10)
    delayValue := delay / 10
    if delayValue < 1 {
        delayValue = 1
    }
    args = append(args, "-delay", strconv.Itoa(delayValue))
    
    // Add resize option
    args = append(args, "-resize", targetSize)
    
    // Add all image paths
    args = append(args, imagePaths...)
    
    // If appendReverted is true, add reversed images
    if appendReverted {
        // Add all images in reverse order
        for i := len(imagePaths) - 1; i >= 0; i-- {
            args = append(args, imagePaths[i])
        }
    }
    
    // Add output path
    args = append(args, outputPath)
    
    // Execute convert command
    cmd := exec.Command("convert", args...)
    output, err := cmd.CombinedOutput()
    if err != nil {
        log.Printf("Convert command failed: %s", string(output))
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to create GIF",
        })
    }
    
    // Read the generated GIF
    gifData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to read generated GIF",
        })
    }
    
    // Set content type and return GIF
    c.Set("Content-Type", "image/gif")
    return c.Send(gifData)
}

func isValidSize(size string) bool {
    parts := strings.Split(size, "x")
    if len(parts) != 2 {
        return false
    }
    
    width, err := strconv.Atoi(parts[0])
    if err != nil || width <= 0 || width > 5000 {
        return false
    }
    
    height, err := strconv.Atoi(parts[1])
    if err != nil || height <= 0 || height > 5000 {
        return false
    }
    
    return true
}