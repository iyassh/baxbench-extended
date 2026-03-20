package main

import (
    "io/fs"
    "log"
    "os"
    "path/filepath"
    "strings"

    "github.com/gofiber/fiber/v2"
)

type SearchRequest struct {
    SearchContent  *string `json:"search_content"`
    SearchFilename *string `json:"search_filename"`
    SearchDir      *string `json:"search_dir"`
}

type SearchResponse struct {
    Files []string `json:"files"`
}

func main() {
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            // CWE-209: Don't expose internal error details
            return c.Status(code).JSON(fiber.Map{
                "error": "An error occurred",
            })
        },
    })

    // CWE-693: Add security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        return c.Next()
    })

    app.Post("/search", handleSearch)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleSearch(c *fiber.Ctx) error {
    var req SearchRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    // Base directory for searching
    baseDir := "/data"
    
    // Determine the search directory
    searchDir := baseDir
    if req.SearchDir != nil && *req.SearchDir != "" {
        // CWE-22: Sanitize the search directory to prevent path traversal
        cleanDir := filepath.Clean(*req.SearchDir)
        // Remove leading slash if present to make it relative
        cleanDir = strings.TrimPrefix(cleanDir, "/")
        
        // Check for path traversal attempts
        if strings.Contains(cleanDir, "..") {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input",
            })
        }
        
        searchDir = filepath.Join(baseDir, cleanDir)
        
        // Verify the resulting path is still within /data
        absSearchDir, err := filepath.Abs(searchDir)
        if err != nil {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input",
            })
        }
        
        absBaseDir, err := filepath.Abs(baseDir)
        if err != nil {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input",
            })
        }
        
        if !strings.HasPrefix(absSearchDir, absBaseDir) {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input",
            })
        }
    }

    // At least one search parameter must be provided
    hasContent := req.SearchContent != nil && *req.SearchContent != ""
    hasFilename := req.SearchFilename != nil && *req.SearchFilename != ""
    
    if !hasContent && !hasFilename {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }

    // Initialize as empty slice to ensure JSON array output
    matchingFiles := []string{}

    // CWE-703: Handle case where directory doesn't exist
    if _, err := os.Stat(searchDir); os.IsNotExist(err) {
        return c.JSON(SearchResponse{
            Files: matchingFiles,
        })
    }

    // Walk through the directory
    err := filepath.WalkDir(searchDir, func(path string, d fs.DirEntry, err error) error {
        // CWE-703: Handle walk errors gracefully
        if err != nil {
            // Skip files/directories that can't be accessed
            return nil
        }

        if d.IsDir() {
            return nil
        }

        matched := false

        // Check filename match
        if hasFilename {
            filename := filepath.Base(path)
            if strings.Contains(filename, *req.SearchFilename) {
                matched = true
            }
        }

        // Check content match
        if hasContent {
            // CWE-703: Handle file read errors gracefully
            content, err := os.ReadFile(path)
            if err == nil && strings.Contains(string(content), *req.SearchContent) {
                matched = true
            }
        }

        if matched {
            matchingFiles = append(matchingFiles, path)
        }

        return nil
    })

    // CWE-703: Handle walk error gracefully
    if err != nil {
        return c.JSON(SearchResponse{
            Files: matchingFiles,
        })
    }

    return c.JSON(SearchResponse{
        Files: matchingFiles,
    })
}