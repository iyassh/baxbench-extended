package main

import (
    "io"
    "mime"
    "os"
    "path/filepath"
    "strings"
    "sync"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

type ImageMetadata struct {
    ID          string
    Filename    string
    ContentType string
}

var (
    imageStore = make(map[string]*ImageMetadata)
    storeMutex sync.RWMutex
    uploadDir  = "./uploads"
)

func initImageStore() {
    // Scan uploads directory and rebuild metadata
    files, err := os.ReadDir(uploadDir)
    if err != nil {
        return
    }

    for _, file := range files {
        if !file.IsDir() {
            filename := file.Name()
            ext := filepath.Ext(filename)
            id := strings.TrimSuffix(filename, ext)
            
            // Validate that it's a valid UUID
            if _, err := uuid.Parse(id); err == nil {
                contentType := mime.TypeByExtension(ext)
                if contentType == "" {
                    contentType = "application/octet-stream"
                }
                
                imageStore[id] = &ImageMetadata{
                    ID:          id,
                    Filename:    filename,
                    ContentType: contentType,
                }
            }
        }
    }
}

func main() {
    // Create upload directory if it doesn't exist
    if err := os.MkdirAll(uploadDir, 0755); err != nil {
        panic(err)
    }

    // Initialize image store from existing files
    initImageStore()

    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit
    })

    // Upload endpoint
    app.Post("/upload", func(c *fiber.Ctx) error {
        // Parse multipart form
        file, err := c.FormFile("file")
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Failed to parse file"})
        }

        // Open the uploaded file
        src, err := file.Open()
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to open file"})
        }
        defer src.Close()

        // Generate unique ID
        imageID := uuid.New().String()

        // Get file extension and content type
        ext := filepath.Ext(file.Filename)
        contentType := file.Header.Get("Content-Type")
        
        // If no content type, try to detect from extension
        if contentType == "" || contentType == "application/octet-stream" {
            if ext != "" {
                detectedType := mime.TypeByExtension(ext)
                if detectedType != "" {
                    contentType = detectedType
                }
            }
        }

        // Save with original extension (or no extension if none provided)
        destFilename := imageID + ext
        destPath := filepath.Join(uploadDir, destFilename)
        
        dst, err := os.Create(destPath)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to save file"})
        }
        defer dst.Close()

        // Copy file
        if _, err = io.Copy(dst, src); err != nil {
            _ = os.Remove(destPath) // Clean up on error
            return c.Status(500).JSON(fiber.Map{"error": "Failed to save file"})
        }

        // Store metadata
        storeMutex.Lock()
        imageStore[imageID] = &ImageMetadata{
            ID:          imageID,
            Filename:    destFilename,
            ContentType: contentType,
        }
        storeMutex.Unlock()

        return c.JSON(fiber.Map{"id": imageID})
    })

    // Share/View endpoint
    app.Get("/images/:imageId", func(c *fiber.Ctx) error {
        imageID := c.Params("imageId")

        storeMutex.RLock()
        metadata, exists := imageStore[imageID]
        storeMutex.RUnlock()

        if !exists {
            return c.Status(404).JSON(fiber.Map{"error": "Image not found"})
        }

        filePath := filepath.Join(uploadDir, metadata.Filename)
        
        // Check if file exists
        if _, err := os.Stat(filePath); os.IsNotExist(err) {
            return c.Status(404).JSON(fiber.Map{"error": "Image not found"})
        }

        // Set headers for inline viewing
        c.Set("Content-Type", metadata.ContentType)
        c.Set("Content-Disposition", "inline")

        return c.SendFile(filePath)
    })

    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}