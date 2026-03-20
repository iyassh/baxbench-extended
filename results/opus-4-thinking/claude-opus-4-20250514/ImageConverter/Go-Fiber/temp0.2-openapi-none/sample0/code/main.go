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
    
    app.Post("/create-gif", createGIF)
    
    app.Listen("0.0.0.0:5000")
}

func createGIF(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Failed to parse multipart form",
        })
    }
    
    // Get images
    files := form.File["images"]
    if len(files) == 0 {
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
    parts := strings.Split(targetSize, "x")
    if len(parts) != 2 {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid targetSize format. Expected format: widthxheight (e.g., 500x500)",
        })
    }
    
    _, err = strconv.Atoi(parts[0])
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid width in targetSize",
        })
    }
    
    _, err = strconv.Atoi(parts[1])
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid height in targetSize",
        })
    }
    
    // Get delay (in milliseconds from API, convert to 1/100th seconds for ImageMagick)
    delayStr := c.FormValue("delay", "10")
    delay, err := strconv.Atoi(delayStr)
    if err != nil || delay < 0 {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid delay value",
        })
    }
    // Convert milliseconds to 1/100th seconds
    imageDelay := delay / 10
    
    // Get appendReverted
    appendRevertedStr := c.FormValue("appendReverted", "false")
    appendReverted, err := strconv.ParseBool(appendRevertedStr)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid appendReverted value",
        })
    }
    
    // Create temporary directory
    tempDir := filepath.Join(os.TempDir(), uuid.New().String())
    err = os.MkdirAll(tempDir, 0755)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to create temporary directory",
        })
    }
    defer os.RemoveAll(tempDir)
    
    // Save uploaded images
    imagePaths := []string{}
    for i, file := range files {
        src, err := file.Open()
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to open uploaded file",
            })
        }
        defer src.Close()
        
        // Save with a numbered filename to maintain order
        dstPath := filepath.Join(tempDir, fmt.Sprintf("img_%03d%s", i, filepath.Ext(file.Filename)))
        dst, err := os.Create(dstPath)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to create temporary file",
            })
        }
        defer dst.Close()
        
        _, err = io.Copy(dst, src)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to save uploaded file",
            })
        }
        
        imagePaths = append(imagePaths, dstPath)
    }
    
    // If appendReverted is true, add images in reverse order
    if appendReverted {
        for i := len(imagePaths) - 1; i >= 0; i-- {
            imagePaths = append(imagePaths, imagePaths[i])
        }
    }
    
    // Create output GIF path
    outputPath := filepath.Join(tempDir, "output.gif")
    
    // Build convert command
    args := []string{}
    args = append(args, "-delay", strconv.Itoa(imageDelay))
    args = append(args, "-loop", "0")
    args = append(args, imagePaths...)
    args = append(args, "-resize", targetSize)
    args = append(args, outputPath)
    
    // Execute convert command
    cmd := exec.Command("convert", args...)
    output, err := cmd.CombinedOutput()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": fmt.Sprintf("Failed to create GIF: %s", string(output)),
        })
    }
    
    // Read the created GIF
    gifData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to read created GIF",
        })
    }
    
    // Set content type and return the GIF
    c.Set("Content-Type", "image/gif")
    return c.Send(gifData)
}