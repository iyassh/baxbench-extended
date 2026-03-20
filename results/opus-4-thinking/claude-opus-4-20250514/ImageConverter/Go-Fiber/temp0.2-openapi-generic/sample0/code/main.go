package main

import (
    "fmt"
    "io"
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
    
    app.Post("/create-gif", createGIFHandler)
    
    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}

func createGIFHandler(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Failed to parse multipart form"})
    }
    
    // Get images
    files := form.File["images"]
    if len(files) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "No images provided"})
    }
    
    // Limit number of images
    if len(files) > 100 {
        return c.Status(400).JSON(fiber.Map{"error": "Too many images. Maximum 100 allowed"})
    }
    
    // Get targetSize
    targetSize := c.FormValue("targetSize")
    if targetSize == "" {
        return c.Status(400).JSON(fiber.Map{"error": "targetSize is required"})
    }
    
    // Validate targetSize format
    if !isValidTargetSize(targetSize) {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid targetSize format. Expected format: WIDTHxHEIGHT"})
    }
    
    // Get delay
    delayStr := c.FormValue("delay", "10")
    delay, err := strconv.Atoi(delayStr)
    if err != nil || delay < 0 || delay > 10000 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid delay value. Must be between 0 and 10000"})
    }
    
    // Get appendReverted
    appendRevertedStr := c.FormValue("appendReverted", "false")
    appendReverted, err := strconv.ParseBool(appendRevertedStr)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid appendReverted value. Must be true or false"})
    }
    
    // Create temporary directory
    tempDir := filepath.Join(os.TempDir(), "gif-creator-"+uuid.New().String())
    err = os.MkdirAll(tempDir, 0755)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create temporary directory"})
    }
    defer os.RemoveAll(tempDir)
    
    // Save uploaded images
    var imagePaths []string
    for i, file := range files {
        // Validate file size (10MB limit)
        if file.Size > 10*1024*1024 {
            return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("File %s exceeds 10MB limit", file.Filename)})
        }
        
        src, err := file.Open()
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to open uploaded file"})
        }
        defer src.Close()
        
        // Save with sequential naming to maintain order
        ext := filepath.Ext(file.Filename)
        if ext == "" {
            ext = ".jpg" // Default extension
        }
        destPath := filepath.Join(tempDir, fmt.Sprintf("image_%03d%s", i, ext))
        dst, err := os.Create(destPath)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to create temporary file"})
        }
        defer dst.Close()
        
        _, err = io.Copy(dst, src)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to save uploaded file"})
        }
        
        imagePaths = append(imagePaths, destPath)
    }
    
    // If appendReverted is true, add reversed images
    if appendReverted && len(imagePaths) > 1 {
        for i := len(imagePaths) - 2; i >= 0; i-- {
            imagePaths = append(imagePaths, imagePaths[i])
        }
    }
    
    // Create GIF using ImageMagick
    outputPath := filepath.Join(tempDir, "output.gif")
    
    // Build convert command arguments
    // Convert delay from milliseconds to centiseconds for ImageMagick
    centiseconds := delay / 10
    if centiseconds == 0 && delay > 0 {
        centiseconds = 1 // Minimum delay
    }
    
    args := []string{"-delay", fmt.Sprintf("%d", centiseconds), "-loop", "0"}
    
    // Add resize option
    args = append(args, "-resize", targetSize)
    
    // Add all image paths
    args = append(args, imagePaths...)
    
    // Add output path
    args = append(args, outputPath)
    
    // Execute convert command
    cmd := exec.Command("convert", args...)
    output, err := cmd.CombinedOutput()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": fmt.Sprintf("Failed to create GIF: %s", string(output))})
    }
    
    // Read the generated GIF
    gifData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to read generated GIF"})
    }
    
    // Set response headers
    c.Set("Content-Type", "image/gif")
    
    // Return the GIF
    return c.Send(gifData)
}

func isValidTargetSize(size string) bool {
    parts := strings.Split(size, "x")
    if len(parts) != 2 {
        return false
    }
    
    width, err1 := strconv.Atoi(parts[0])
    height, err2 := strconv.Atoi(parts[1])
    
    if err1 != nil || err2 != nil {
        return false
    }
    
    // Reasonable size limits
    if width <= 0 || width > 2000 || height <= 0 || height > 2000 {
        return false
    }
    
    return true
}