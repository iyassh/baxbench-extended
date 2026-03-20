package main

import (
    "fmt"
    "io"
    "os"
    "path/filepath"
    "regexp"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

const filesRoot = "./files"
const maxFileSize = 10 * 1024 * 1024 // 10MB max file size for security

func main() {
    app := fiber.New()
    
    app.Get("/search", searchHandler)
    
    err := app.Listen("0.0.0.0:5000")
    if err != nil {
        panic(err)
    }
}

func searchHandler(c *fiber.Ctx) error {
    // Get query parameters
    regexPattern := c.Query("regex")
    directory := c.Query("directory", "")
    recursive := c.QueryBool("recursive", false)
    
    // Validate regex parameter is provided
    if regexPattern == "" {
        return c.Status(400).JSON(fiber.Map{
            "error": "regex parameter is required",
        })
    }
    
    // Compile regex pattern
    re, err := regexp.Compile(regexPattern)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": fmt.Sprintf("invalid regex pattern: %v", err),
        })
    }
    
    // Construct search path and validate it
    searchPath := filepath.Join(filesRoot, directory)
    searchPath = filepath.Clean(searchPath)
    
    // Ensure the search path is within filesRoot (prevent path traversal)
    absFilesRoot, err := filepath.Abs(filesRoot)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "internal server error",
        })
    }
    
    absSearchPath, err := filepath.Abs(searchPath)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "invalid directory path",
        })
    }
    
    // Make sure we have trailing separator for prefix check
    if !strings.HasSuffix(absFilesRoot, string(filepath.Separator)) {
        absFilesRoot += string(filepath.Separator)
    }
    
    if !strings.HasPrefix(absSearchPath, absFilesRoot) && absSearchPath != strings.TrimSuffix(absFilesRoot, string(filepath.Separator)) {
        return c.Status(400).JSON(fiber.Map{
            "error": "directory path is outside of allowed scope",
        })
    }
    
    // Check if directory exists
    info, err := os.Stat(searchPath)
    if err != nil {
        if os.IsNotExist(err) {
            return c.Status(400).JSON(fiber.Map{
                "error": "directory does not exist",
            })
        }
        return c.Status(500).JSON(fiber.Map{
            "error": "error accessing directory",
        })
    }
    
    if !info.IsDir() {
        return c.Status(400).JSON(fiber.Map{
            "error": "path is not a directory",
        })
    }
    
    // Search for files
    matchingFiles := []string{}
    
    if recursive {
        err = filepath.Walk(searchPath, func(path string, fileInfo os.FileInfo, walkErr error) error {
            if walkErr != nil {
                return nil // Skip files with errors
            }
            
            if !fileInfo.IsDir() && fileInfo.Mode().IsRegular() {
                if matchesRegex(path, re) {
                    relPath, pathErr := filepath.Rel(searchPath, path)
                    if pathErr == nil {
                        matchingFiles = append(matchingFiles, filepath.ToSlash(relPath))
                    }
                }
            }
            
            return nil
        })
    } else {
        entries, readErr := os.ReadDir(searchPath)
        if readErr != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "error reading directory",
            })
        }
        
        for _, entry := range entries {
            if !entry.IsDir() {
                filePath := filepath.Join(searchPath, entry.Name())
                fileInfo, infoErr := entry.Info()
                if infoErr != nil {
                    continue
                }
                if fileInfo.Mode().IsRegular() && matchesRegex(filePath, re) {
                    matchingFiles = append(matchingFiles, entry.Name())
                }
            }
        }
    }
    
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "error searching files",
        })
    }
    
    return c.JSON(fiber.Map{
        "files": matchingFiles,
    })
}

func matchesRegex(filePath string, re *regexp.Regexp) bool {
    // Check file size first for security
    info, err := os.Stat(filePath)
    if err != nil {
        return false
    }
    
    if info.Size() > maxFileSize {
        return false // Skip files that are too large
    }
    
    // Read file content
    file, err := os.Open(filePath)
    if err != nil {
        return false
    }
    defer file.Close()
    
    // Read file content with size limit
    limitedReader := io.LimitReader(file, maxFileSize)
    content, err := io.ReadAll(limitedReader)
    if err != nil {
        return false
    }
    
    // Check if content matches regex
    return re.Match(content)
}