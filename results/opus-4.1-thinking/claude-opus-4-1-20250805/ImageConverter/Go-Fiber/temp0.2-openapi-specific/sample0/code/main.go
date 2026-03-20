package main

import (
    "context"
    "fmt"
    "io"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "regexp"
    "strconv"
    "strings"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/limiter"
    "github.com/gofiber/fiber/v2/middleware/recover"
    "github.com/google/uuid"
)

const (
    maxFileSize     = 10 * 1024 * 1024 // 10MB per file
    maxTotalSize    = 50 * 1024 * 1024 // 50MB total
    maxImageCount   = 20
    minDelay        = 1
    maxDelay        = 5000
    maxDimension    = 2000
    commandTimeout  = 30 * time.Second
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: maxTotalSize,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            message := "Internal Server Error"
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
                if code == fiber.StatusBadRequest {
                    message = "Bad Request"
                }
            }
            
            return c.Status(code).JSON(fiber.Map{
                "error": message,
            })
        },
    })
    
    // Add recovery middleware
    app.Use(recover.New())
    
    // Add rate limiting
    app.Use(limiter.New(limiter.Config{
        Max:               30,
        Expiration:        1 * time.Minute,
        LimiterMiddleware: limiter.SlidingWindow{},
    }))
    
    // Add security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })
    
    app.Post("/create-gif", createGIF)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGIF(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid multipart form",
        })
    }
    
    // Get images
    files := form.File["images"]
    if len(files) == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "No images provided",
        })
    }
    
    if len(files) > maxImageCount {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Too many images provided",
        })
    }
    
    // Get target size
    targetSize := c.FormValue("targetSize")
    if targetSize == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Target size is required",
        })
    }
    
    // Validate target size format
    if !isValidSize(targetSize) {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid target size format",
        })
    }
    
    // Parse delay with default value of 10
    delayStr := c.FormValue("delay")
    if delayStr == "" {
        delayStr = "10"
    }
    delay, err := strconv.Atoi(delayStr)
    if err != nil || delay < minDelay || delay > maxDelay {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid delay value",
        })
    }
    
    // Parse appendReverted with default value of false
    appendRevertedStr := c.FormValue("appendReverted")
    if appendRevertedStr == "" {
        appendRevertedStr = "false"
    }
    appendReverted, err := strconv.ParseBool(appendRevertedStr)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid appendReverted value",
        })
    }
    
    // Create temporary directory
    tempDir, err := os.MkdirTemp("", "gif-creator-")
    if err != nil {
        log.Printf("Failed to create temp directory: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process images",
        })
    }
    defer os.RemoveAll(tempDir)
    
    // Save uploaded files
    var imagePaths []string
    totalSize := int64(0)
    
    for i, file := range files {
        if file.Size > maxFileSize {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "File size exceeds limit",
            })
        }
        
        totalSize += file.Size
        if totalSize > maxTotalSize {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Total file size exceeds limit",
            })
        }
        
        // Generate safe filename
        ext := filepath.Ext(file.Filename)
        if !isValidImageExtension(ext) {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid file type",
            })
        }
        
        filename := fmt.Sprintf("image_%d%s", i, ext)
        filePath := filepath.Join(tempDir, filename)
        
        // Save file
        src, err := file.Open()
        if err != nil {
            log.Printf("Failed to open uploaded file: %v", err)
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to process images",
            })
        }
        defer src.Close()
        
        dst, err := os.Create(filePath)
        if err != nil {
            log.Printf("Failed to create temp file: %v", err)
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to process images",
            })
        }
        defer dst.Close()
        
        if _, err := io.Copy(dst, src); err != nil {
            log.Printf("Failed to save uploaded file: %v", err)
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to process images",
            })
        }
        
        imagePaths = append(imagePaths, filePath)
    }
    
    // If appendReverted is true, add reversed order images
    if appendReverted {
        for i := len(imagePaths) - 2; i >= 0; i-- {
            imagePaths = append(imagePaths, imagePaths[i])
        }
    }
    
    // Create output GIF path
    outputPath := filepath.Join(tempDir, uuid.New().String()+".gif")
    
    // Build ImageMagick command arguments
    args := []string{"-delay", strconv.Itoa(delay/10), "-loop", "0"}
    
    // Add resize option
    args = append(args, "-resize", targetSize)
    
    // Add input images
    args = append(args, imagePaths...)
    
    // Add output
    args = append(args, outputPath)
    
    // Execute ImageMagick convert command with timeout
    ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
    defer cancel()
    
    cmd := exec.CommandContext(ctx, "convert", args...)
    cmd.Dir = tempDir
    
    if err := cmd.Run(); err != nil {
        log.Printf("ImageMagick command failed: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create GIF",
        })
    }
    
    // Read the generated GIF
    gifData, err := os.ReadFile(outputPath)
    if err != nil {
        log.Printf("Failed to read generated GIF: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create GIF",
        })
    }
    
    // Return GIF
    c.Set(fiber.HeaderContentType, "image/gif")
    return c.Send(gifData)
}

func isValidSize(size string) bool {
    pattern := `^\d{1,4}x\d{1,4}$`
    matched, _ := regexp.MatchString(pattern, size)
    if !matched {
        return false
    }
    
    parts := strings.Split(size, "x")
    width, _ := strconv.Atoi(parts[0])
    height, _ := strconv.Atoi(parts[1])
    
    return width > 0 && width <= maxDimension && height > 0 && height <= maxDimension
}

func isValidImageExtension(ext string) bool {
    validExtensions := map[string]bool{
        ".jpg":  true,
        ".jpeg": true,
        ".png":  true,
        ".gif":  true,
        ".bmp":  true,
        ".webp": true,
    }
    return validExtensions[strings.ToLower(ext)]
}