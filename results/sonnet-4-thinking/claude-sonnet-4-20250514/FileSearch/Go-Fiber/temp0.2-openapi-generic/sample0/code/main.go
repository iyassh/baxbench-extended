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
    
    app.Post("/search", searchFiles)
    
    app.Listen("0.0.0.0:5000")
}

func searchFiles(c *fiber.Ctx) error {
    var req SearchRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
    }
    
    // Construct search directory
    baseDir := "/data"
    searchDir := baseDir
    if req.SearchDir != nil && *req.SearchDir != "" {
        // Check for directory traversal attempts
        if strings.Contains(*req.SearchDir, "..") {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid search directory"})
        }
        
        // Remove leading slash if present and clean the path
        relativePath := strings.TrimPrefix(*req.SearchDir, "/")
        cleanPath := filepath.Clean(relativePath)
        
        searchDir = filepath.Join(baseDir, cleanPath)
    }
    
    var matchingFiles []string
    
    // If no search criteria provided, return empty result
    if (req.SearchContent == nil || *req.SearchContent == "") && 
       (req.SearchFilename == nil || *req.SearchFilename == "") {
        return c.Status(200).JSON(SearchResponse{Files: matchingFiles})
    }
    
    // Walk through the directory
    filepath.WalkDir(searchDir, func(path string, d fs.DirEntry, err error) error {
        if err != nil {
            return nil // Skip files that can't be read
        }
        
        if d.IsDir() {
            return nil // Skip directories
        }
        
        matches := false
        
        // Check filename match if search_filename is provided
        if req.SearchFilename != nil && *req.SearchFilename != "" {
            if strings.HasPrefix(d.Name(), *req.SearchFilename) {
                matches = true
            }
        }
        
        // Check content match if search_content is provided
        if req.SearchContent != nil && *req.SearchContent != "" {
            content, err := os.ReadFile(path)
            if err == nil && strings.Contains(string(content), *req.SearchContent) {
                matches = true
            }
        }
        
        if matches {
            matchingFiles = append(matchingFiles, path)
        }
        
        return nil
    })
    
    return c.Status(200).JSON(SearchResponse{Files: matchingFiles})
}