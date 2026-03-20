package main

import (
    "os"
    "path/filepath"
    "regexp"
    "strings"
    "time"
    
    "github.com/gofiber/fiber/v2"
)

const (
    filesRoot = "./files"
    maxFileSize = 10 * 1024 * 1024 // 10MB max file size to prevent resource exhaustion
)

type SearchResponse struct {
    Files []string `json:"files"`
}

type ErrorResponse struct {
    Error string `json:"error"`
}

func main() {
    app := fiber.New(fiber.Config{
        ReadTimeout:  10 * time.Second,
        WriteTimeout: 10 * time.Second,
        BodyLimit:    1 * 1024 * 1024, // 1MB body limit
    })
    
    // Add security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })
    
    app.Get("/search", searchHandler)
    
    app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
    // Get query parameters
    regexPattern := c.Query("regex")
    directory := c.Query("directory")
    recursive := c.QueryBool("recursive", false)
    
    // Validate regex pattern is provided
    if regexPattern == "" {
        return c.Status(400).JSON(ErrorResponse{
            Error: "regex parameter is required",
        })
    }
    
    // Compile regex pattern
    re, err := regexp.Compile(regexPattern)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{
            Error: "invalid regex pattern",
        })
    }
    
    // Determine search path
    searchPath := filesRoot
    if directory != "" {
        // Clean and validate the directory path to prevent path traversal
        cleanPath := filepath.Clean(directory)
        
        // Check for path traversal attempts
        if strings.Contains(cleanPath, "..") || filepath.IsAbs(cleanPath) {
            return c.Status(400).JSON(ErrorResponse{
                Error: "invalid directory path",
            })
        }
        
        searchPath = filepath.Join(filesRoot, cleanPath)
    }
    
    // Verify the search path is within the allowed scope
    absSearchPath, err := filepath.Abs(searchPath)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{
            Error: "invalid directory path",
        })
    }
    
    absFilesRoot, err := filepath.Abs(filesRoot)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Error: "internal server error",
        })
    }
    
    // Ensure search path is within filesRoot
    if !strings.HasPrefix(absSearchPath, absFilesRoot) {
        return c.Status(400).JSON(ErrorResponse{
            Error: "directory path outside of allowed scope",
        })
    }
    
    // Check if directory exists and is a directory
    info, err := os.Stat(searchPath)
    if err != nil {
        if os.IsNotExist(err) {
            return c.Status(400).JSON(ErrorResponse{
                Error: "directory does not exist",
            })
        }
        return c.Status(500).JSON(ErrorResponse{
            Error: "internal server error",
        })
    }
    
    if !info.IsDir() {
        return c.Status(400).JSON(ErrorResponse{
            Error: "path is not a directory",
        })
    }
    
    // Perform the file search
    var matchingFiles []string
    err = searchFiles(searchPath, searchPath, re, recursive, &matchingFiles)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Error: "error during file search",
        })
    }
    
    return c.JSON(SearchResponse{
        Files: matchingFiles,
    })
}

func searchFiles(basePath, currentPath string, re *regexp.Regexp, recursive bool, results *[]string) error {
    entries, err := os.ReadDir(currentPath)
    if err != nil {
        return err
    }
    
    for _, entry := range entries {
        fullPath := filepath.Join(currentPath, entry.Name())
        
        if entry.IsDir() {
            if recursive {
                // Recursively search subdirectories
                err := searchFiles(basePath, fullPath, re, recursive, results)
                if err != nil {
                    // Continue on error for individual subdirectories
                    continue
                }
            }
            continue
        }
        
        // Get file info to check size
        info, err := entry.Info()
        if err != nil {
            // Skip files we can't get info for
            continue
        }
        
        // Skip files that are too large to prevent resource exhaustion
        if info.Size() > maxFileSize {
            continue
        }
        
        // Read file content
        content, err := os.ReadFile(fullPath)
        if err != nil {
            // Skip files that can't be read
            continue
        }
        
        // Check if content matches the regex pattern
        if re.Match(content) {
            // Get relative path from the base search path
            relPath, err := filepath.Rel(basePath, fullPath)
            if err != nil {
                continue
            }
            
            // Convert to forward slashes for consistency across platforms
            relPath = filepath.ToSlash(relPath)
            *results = append(*results, relPath)
        }
    }
    
    return nil
}