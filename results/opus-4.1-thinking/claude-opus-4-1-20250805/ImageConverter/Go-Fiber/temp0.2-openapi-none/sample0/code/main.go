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

    app.Post("/create-gif", createGIF)

    app.Listen("0.0.0.0:5000")
}

func createGIF(c *fiber.Ctx) error {
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

    // Get targetSize
    targetSize := c.FormValue("targetSize")
    if targetSize == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Target size is required"})
    }

    // Validate targetSize format (should be like "500x500")
    if !strings.Contains(targetSize, "x") {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid target size format. Use format like '500x500'"})
    }

    // Get delay (default 10)
    delayStr := c.FormValue("delay", "10")
    delay, err := strconv.Atoi(delayStr)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid delay value"})
    }

    // Get appendReverted (default false)
    appendRevertedStr := c.FormValue("appendReverted", "false")
    appendReverted, err := strconv.ParseBool(appendRevertedStr)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid appendReverted value"})
    }

    // Create temporary directory for processing
    tempDir := filepath.Join(os.TempDir(), uuid.New().String())
    err = os.MkdirAll(tempDir, 0755)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create temporary directory"})
    }
    defer os.RemoveAll(tempDir) // Clean up when done

    // Save uploaded images to temp directory
    var imagePaths []string
    for i, file := range files {
        ext := filepath.Ext(file.Filename)
        if ext == "" {
            ext = ".jpg" // Default extension if none provided
        }
        tempPath := filepath.Join(tempDir, fmt.Sprintf("image_%d%s", i, ext))
        err := c.SaveFile(file, tempPath)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to save uploaded image"})
        }
        imagePaths = append(imagePaths, tempPath)
    }

    // If appendReverted is true, add reversed order images
    if appendReverted && len(imagePaths) > 1 {
        // Add images in reverse order (excluding the last one to avoid duplication at the turning point)
        for i := len(imagePaths) - 2; i >= 0; i-- {
            imagePaths = append(imagePaths, imagePaths[i])
        }
    }

    // Create output GIF path
    outputPath := filepath.Join(tempDir, "output.gif")

    // Build ImageMagick convert command
    // Convert milliseconds to centiseconds for ImageMagick
    imageDelay := delay / 10
    if imageDelay < 1 {
        imageDelay = 1 // Minimum delay of 1 centisecond
    }
    
    args := []string{"-delay", fmt.Sprintf("%d", imageDelay)}
    args = append(args, imagePaths...)
    args = append(args, "-resize", targetSize, "-loop", "0", outputPath)

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

    // Set response headers and send GIF
    c.Set("Content-Type", "image/gif")
    return c.Send(gifData)
}