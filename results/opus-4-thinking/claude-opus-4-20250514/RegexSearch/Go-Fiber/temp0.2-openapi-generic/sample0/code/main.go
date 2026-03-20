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
const maxFileSize = 10 * 1024 * 1024 // 10MB limit for file reading

type SearchResponse struct {
    Files []string `json:"files"`
}

type ErrorResponse struct {
    Error string `json:"error"`
}

func main() {
    app := fiber.New()

    app.Get("/search", searchHandler)

    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}

func searchHandler(c *fiber.Ctx) error {
    // Get query parameters
    regexPattern := c.Query("regex")
    directory := c.Query("directory", "")
    recursive := c.QueryBool("recursive", false)

    // Validate regex parameter
    if regexPattern == "" {
        return c.Status(400).JSON(ErrorResponse{Error: "regex parameter is required"})
    }

    // Compile regex
    regex, err := regexp.Compile(regexPattern)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{Error: fmt.Sprintf("invalid regex: %v", err)})
    }

    // Clean and validate directory parameter to prevent directory traversal
    directory = filepath.Clean(directory)
    
    // Build search path
    searchPath := filepath.Join(filesRoot, directory)
    searchPath = filepath.Clean(searchPath)
    
    // Ensure the search path is within the files root
    absSearchPath, err := filepath.Abs(searchPath)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{Error: "invalid directory path"})
    }
    
    absFilesRoot, err := filepath.Abs(filesRoot)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "internal server error"})
    }
    
    // Ensure we're not going outside the files root
    relPath, err := filepath.Rel(absFilesRoot, absSearchPath)
    if err != nil || strings.HasPrefix(relPath, "..") {
        return c.Status(400).JSON(ErrorResponse{Error: "directory path outside of allowed root"})
    }

    // Check if directory exists
    info, err := os.Stat(searchPath)
    if os.IsNotExist(err) {
        return c.Status(400).JSON(ErrorResponse{Error: "directory does not exist"})
    }
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "error accessing directory"})
    }
    if !info.IsDir() {
        return c.Status(400).JSON(ErrorResponse{Error: "path is not a directory"})
    }

    // Search files
    matchingFiles := []string{}
    
    err = searchFiles(searchPath, searchPath, regex, recursive, &matchingFiles)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: fmt.Sprintf("error searching files: %v", err)})
    }

    return c.JSON(SearchResponse{Files: matchingFiles})
}

func searchFiles(currentPath string, basePath string, regex *regexp.Regexp, recursive bool, results *[]string) error {
    entries, err := os.ReadDir(currentPath)
    if err != nil {
        return err
    }

    for _, entry := range entries {
        fullPath := filepath.Join(currentPath, entry.Name())
        
        if entry.IsDir() {
            if recursive {
                if err := searchFiles(fullPath, basePath, regex, recursive, results); err != nil {
                    return err
                }
            }
        } else {
            // Check if file content matches regex
            matches, err := fileMatchesRegex(fullPath, regex)
            if err != nil {
                // Skip files that can't be read (permissions, etc)
                continue
            }
            
            if matches {
                // Get relative path from the base search directory
                relativePath, err := filepath.Rel(basePath, fullPath)
                if err != nil {
                    return err
                }
                // Convert to forward slashes for consistent output
                *results = append(*results, filepath.ToSlash(relativePath))
            }
        }
    }
    
    return nil
}

func fileMatchesRegex(filePath string, regex *regexp.Regexp) (bool, error) {
    file, err := os.Open(filePath)
    if err != nil {
        return false, err
    }
    defer file.Close()

    // Read file content with a reasonable limit to prevent memory issues
    limited := io.LimitReader(file, maxFileSize)
    
    content, err := io.ReadAll(limited)
    if err != nil {
        return false, err
    }

    return regex.Match(content), nil
}