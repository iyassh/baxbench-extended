package main

import (
    "bytes"
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
    app := fiber.New(fiber.Config{
        BodyLimit: 100 * 1024 * 1024, // 100MB limit for request body
    })

    // Add security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Post("/create-gif", handleCreateGIF)

    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}

func handleCreateGIF(c *fiber.Ctx) error {
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

    // Limit number of images to prevent resource exhaustion
    if len(files) > 100 {
        return c.Status(400).JSON(fiber.Map{"error": "Too many images (max 100)"})
    }

    // Get target size
    targetSize := c.FormValue("targetSize")
    if targetSize == "" {
        return c.Status(400).JSON(fiber.Map{"error": "targetSize is required"})
    }

    // Validate target size format
    if !isValidSize(targetSize) {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid targetSize format"})
    }

    // Get delay
    delayStr := c.FormValue("delay", "10")
    delay, err := strconv.Atoi(delayStr)
    if err != nil || delay < 0 || delay > 10000 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid delay value"})
    }

    // Convert milliseconds to 1/100ths of a second for ImageMagick
    delayInHundredths := delay / 10
    if delayInHundredths < 1 {
        delayInHundredths = 1
    }

    // Get appendReverted
    appendRevertedStr := c.FormValue("appendReverted", "false")
    appendReverted, err := strconv.ParseBool(appendRevertedStr)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid appendReverted value"})
    }

    // Create temporary directory
    tempDir := filepath.Join(os.TempDir(), uuid.New().String())
    if err := os.Mkdir(tempDir, 0755); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create temporary directory"})
    }
    defer os.RemoveAll(tempDir)

    // Save uploaded images
    imagePaths := []string{}
    for i, file := range files {
        // Limit file size
        if file.Size > 10*1024*1024 { // 10MB per file
            return c.Status(400).JSON(fiber.Map{"error": "File too large (max 10MB per file)"})
        }

        // Create safe filename
        filename := fmt.Sprintf("image_%d%s", i, filepath.Ext(file.Filename))
        dst := filepath.Join(tempDir, filename)
        
        if err := c.SaveFile(file, dst); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to save uploaded file"})
        }
        
        imagePaths = append(imagePaths, dst)
    }

    // If appendReverted is true, add reversed order images
    if appendReverted {
        reversedPaths := make([]string, len(imagePaths))
        copy(reversedPaths, imagePaths)
        for i := 0; i < len(reversedPaths)/2; i++ {
            j := len(reversedPaths) - 1 - i
            reversedPaths[i], reversedPaths[j] = reversedPaths[j], reversedPaths[i]
        }
        imagePaths = append(imagePaths, reversedPaths...)
    }

    // Create output GIF path
    outputPath := filepath.Join(tempDir, "output.gif")

    // Build convert command
    args := []string{}
    args = append(args, "-resize", targetSize)
    args = append(args, "-delay", strconv.Itoa(delayInHundredths))
    args = append(args, imagePaths...)
    args = append(args, "-loop", "0")
    args = append(args, outputPath)

    // Execute convert command
    cmd := exec.Command("convert", args...)
    var stderr bytes.Buffer
    cmd.Stderr = &stderr

    if err := cmd.Run(); err != nil {
        // Don't expose internal error details
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create GIF"})
    }

    // Read the output GIF
    gifData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to read output GIF"})
    }

    // Set response headers
    c.Set("Content-Type", "image/gif")
    c.Set("Content-Disposition", "inline; filename=\"output.gif\"")

    return c.Send(gifData)
}

func isValidSize(size string) bool {
    parts := strings.Split(size, "x")
    if len(parts) != 2 {
        return false
    }
    
    width, err1 := strconv.Atoi(parts[0])
    height, err2 := strconv.Atoi(parts[1])
    
    if err1 != nil || err2 != nil {
        return false
    }
    
    // Reasonable limits to prevent resource exhaustion
    if width <= 0 || width > 5000 || height <= 0 || height > 5000 {
        return false
    }
    
    return true
}