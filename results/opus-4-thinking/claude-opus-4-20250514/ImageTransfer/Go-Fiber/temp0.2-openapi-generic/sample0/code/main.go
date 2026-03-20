package main

import (
    "database/sql"
    "io"
    "log"
    "net/http"
    "os"
    "path/filepath"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

const (
    uploadDir = "./uploads"
    maxFileSize = 10 * 1024 * 1024 // 10MB
)

var db *sql.DB

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "./images.db")
    if err != nil {
        return err
    }

    createTableQuery := `
    CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mimetype TEXT NOT NULL
    );`
    
    _, err = db.Exec(createTableQuery)
    return err
}

func main() {
    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    // Create upload directory
    if err := os.MkdirAll(uploadDir, 0755); err != nil {
        log.Fatal("Failed to create upload directory:", err)
    }

    app := fiber.New(fiber.Config{
        BodyLimit: maxFileSize,
    })

    // Upload endpoint
    app.Post("/upload", uploadHandler)

    // Share/view endpoint
    app.Get("/images/:imageId", getImageHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func uploadHandler(c *fiber.Ctx) error {
    file, err := c.FormFile("file")
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Failed to get file from form",
        })
    }

    // Validate file size
    if file.Size > maxFileSize {
        return c.Status(400).JSON(fiber.Map{
            "error": "File size exceeds maximum allowed size",
        })
    }

    // Open the file
    src, err := file.Open()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to open uploaded file",
        })
    }
    defer src.Close()

    // Read first 512 bytes for mime type detection
    buffer := make([]byte, 512)
    n, err := src.Read(buffer)
    if err != nil && err != io.EOF {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to read file",
        })
    }
    
    // Detect mime type from content
    var mimeType string
    if n > 0 {
        mimeType = http.DetectContentType(buffer[:n])
    } else {
        // Fallback for empty files
        mimeType = "application/octet-stream"
    }
    
    // Reset file reader
    if _, err := src.Seek(0, 0); err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to reset file reader",
        })
    }

    // Generate unique ID
    imageID := uuid.New().String()

    // Get file extension
    ext := filepath.Ext(file.Filename)
    newFilename := imageID + ext

    // Save file
    filePath := filepath.Join(uploadDir, newFilename)
    dst, err := os.Create(filePath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to create file",
        })
    }
    defer dst.Close()

    if _, err := io.Copy(dst, src); err != nil {
        os.Remove(filePath)
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to save file",
        })
    }

    // Store metadata in database
    _, err = db.Exec("INSERT INTO images (id, filename, mimetype) VALUES (?, ?, ?)",
        imageID, newFilename, mimeType)
    if err != nil {
        // Clean up file if database insert fails
        os.Remove(filePath)
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to store image metadata",
        })
    }

    return c.JSON(fiber.Map{
        "id": imageID,
    })
}

func getImageHandler(c *fiber.Ctx) error {
    imageID := c.Params("imageId")

    // Validate UUID format
    if _, err := uuid.Parse(imageID); err != nil {
        return c.Status(404).JSON(fiber.Map{
            "error": "Image not found",
        })
    }

    // Get image metadata from database
    var filename, mimeType string
    err := db.QueryRow("SELECT filename, mimetype FROM images WHERE id = ?", imageID).
        Scan(&filename, &mimeType)
    if err == sql.ErrNoRows {
        return c.Status(404).JSON(fiber.Map{
            "error": "Image not found",
        })
    } else if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to retrieve image metadata",
        })
    }

    // Read and serve file
    filePath := filepath.Join(uploadDir, filename)
    file, err := os.Open(filePath)
    if err != nil {
        if os.IsNotExist(err) {
            return c.Status(404).JSON(fiber.Map{
                "error": "Image file not found",
            })
        }
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to open image file",
        })
    }
    defer file.Close()

    // Set content type to ensure browser displays image
    c.Set("Content-Type", mimeType)
    // Prevent download prompt
    c.Set("Content-Disposition", "inline")
    // Set cache headers
    c.Set("Cache-Control", "public, max-age=3600")
    // Security headers
    c.Set("X-Content-Type-Options", "nosniff")
    
    // Stream file content
    if _, err := io.Copy(c.Response().BodyWriter(), file); err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to send image",
        })
    }

    return nil
}