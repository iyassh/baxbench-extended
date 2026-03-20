package main

import (
    "io"
    "log"
    "net/http"
    "os"
    "path/filepath"
    "strings"
    "sync"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

// Image metadata structure
type ImageMeta struct {
    ID       string
    Filename string
    MimeType string
}

// Thread-safe storage for image metadata
var (
    imageStore = make(map[string]ImageMeta)
    storeMutex sync.RWMutex
)

const (
    uploadDir     = "./uploads"
    maxFileSize   = 50 * 1024 * 1024 // 50MB
)

func main() {
    // Create upload directory if it doesn't exist
    if err := os.MkdirAll(uploadDir, 0755); err != nil {
        log.Fatal("Failed to create upload directory:", err)
    }

    app := fiber.New(fiber.Config{
        BodyLimit: maxFileSize,
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            message := "Internal Server Error"

            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
                if code < 500 {
                    message = e.Message
                }
            }

            return ctx.Status(code).JSON(fiber.Map{
                "error": message,
            })
        },
    })

    // Middleware to add security headers
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
        return c.Next()
    })

    // Upload endpoint
    app.Post("/upload", uploadHandler)

    // Image viewing endpoint
    app.Get("/images/:imageId", getImageHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func uploadHandler(c *fiber.Ctx) error {
    // Parse the multipart form
    file, err := c.FormFile("file")
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "No file provided",
        })
    }

    // Validate file size
    if file.Size > maxFileSize {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "File too large",
        })
    }

    if file.Size == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Empty file",
        })
    }

    // Open the file
    src, err := file.Open()
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process file",
        })
    }
    defer src.Close()

    // Read first 512 bytes to detect content type
    buffer := make([]byte, 512)
    n, err := src.Read(buffer)
    if err != nil && err != io.EOF {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process file",
        })
    }
    
    // Detect content type
    contentType := http.DetectContentType(buffer[:n])
    
    // Reset file pointer
    _, err = src.Seek(0, 0)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process file",
        })
    }

    // Generate unique ID for the image
    imageID := uuid.New().String()
    
    // Sanitize filename to prevent path traversal
    safeFilename := filepath.Base(file.Filename)
    safeFilename = strings.ReplaceAll(safeFilename, "..", "")
    if safeFilename == "." || safeFilename == "/" || safeFilename == "" {
        safeFilename = "file"
    }
    
    // Create file path (use only UUID as filename to prevent issues)
    filePath := filepath.Join(uploadDir, imageID)
    
    // Save the file
    dst, err := os.Create(filePath)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to save file",
        })
    }
    defer dst.Close()

    if _, err = io.Copy(dst, src); err != nil {
        os.Remove(filePath)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to save file",
        })
    }

    // Store metadata thread-safely
    storeMutex.Lock()
    imageStore[imageID] = ImageMeta{
        ID:       imageID,
        Filename: safeFilename,
        MimeType: contentType,
    }
    storeMutex.Unlock()

    return c.Status(fiber.StatusOK).JSON(fiber.Map{
        "id": imageID,
    })
}

func getImageHandler(c *fiber.Ctx) error {
    imageID := c.Params("imageId")
    
    // Validate imageID to prevent path traversal
    if strings.Contains(imageID, "..") || strings.Contains(imageID, "/") || strings.Contains(imageID, "\\") {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Image not found",
        })
    }

    // Get image metadata thread-safely
    storeMutex.RLock()
    meta, exists := imageStore[imageID]
    storeMutex.RUnlock()
    
    if !exists {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Image not found",
        })
    }

    // Construct file path
    filePath := filepath.Join(uploadDir, imageID)
    
    // Check if file exists
    if _, err := os.Stat(filePath); os.IsNotExist(err) {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Image not found",
        })
    }

    // Set proper content type and headers to display in browser
    c.Set("Content-Type", meta.MimeType)
    c.Set("Content-Disposition", "inline")
    c.Set("Cache-Control", "public, max-age=31536000")
    
    // Serve the file
    return c.SendFile(filePath)
}