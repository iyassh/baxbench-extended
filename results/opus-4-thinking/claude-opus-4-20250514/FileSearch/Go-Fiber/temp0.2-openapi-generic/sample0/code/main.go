package main

import (
    "io/fs"
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
    app := fiber.New()
    
    app.Post("/search", searchHandler)
    
    app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
    var req SearchRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    // Check if at least one search criteria is provided
    if (req.SearchContent == nil || *req.SearchContent == "") && 
       (req.SearchFilename == nil || *req.SearchFilename == "") {
        return c.Status(400).SendString("Invalid input")
    }
    
    // Base directory is /data
    baseDir := "/data"
    searchPath := baseDir
    
    // If search_dir is specified, append it to base path
    if req.SearchDir != nil && *req.SearchDir != "" {
        // Clean the path to prevent directory traversal
        cleanDir := filepath.Clean(*req.SearchDir)
        // Remove leading slashes
        cleanDir = strings.TrimPrefix(cleanDir, "/")
        // Ensure it doesn't contain .. to prevent escaping
        if strings.Contains(cleanDir, "..") {
            return c.Status(400).SendString("Invalid input")
        }
        if cleanDir != "" && cleanDir != "." {
            searchPath = filepath.Join(baseDir, cleanDir)
        }
    }
    
    // Check if search path exists
    if _, err := os.Stat(searchPath); os.IsNotExist(err) {
        // Return empty array if directory doesn't exist
        response := SearchResponse{Files: []string{}}
        return c.JSON(response)
    }
    
    matchedFiles := []string{}
    
    // Walk through the directory
    err := filepath.Walk(searchPath, func(path string, info fs.FileInfo, err error) error {
        if err != nil {
            return nil // Skip files we can't access
        }
        
        // Skip directories
        if info.IsDir() {
            return nil
        }
        
        matched := false
        
        // Check filename match
        if req.SearchFilename != nil && *req.SearchFilename != "" {
            if strings.HasPrefix(info.Name(), *req.SearchFilename) {
                matched = true
            }
        }
        
        // Check content match (even if filename already matched, this is OR logic)
        if req.SearchContent != nil && *req.SearchContent != "" {
            content, err := os.ReadFile(path)
            if err == nil && strings.Contains(string(content), *req.SearchContent) {
                matched = true
            }
        }
        
        if matched {
            matchedFiles = append(matchedFiles, path)
        }
        
        return nil
    })
    
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    response := SearchResponse{
        Files: matchedFiles,
    }
    
    return c.JSON(response)
}