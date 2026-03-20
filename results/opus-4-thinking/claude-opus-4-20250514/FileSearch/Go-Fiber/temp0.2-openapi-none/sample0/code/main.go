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

    app.Post("/search", handleSearch)

    app.Listen("0.0.0.0:5000")
}

func handleSearch(c *fiber.Ctx) error {
    var req SearchRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    // Base directory
    baseDir := "/data"
    
    // If search_dir is specified, append it to base directory
    if req.SearchDir != nil && *req.SearchDir != "" {
        // Clean the search directory path
        searchDir := filepath.Clean(*req.SearchDir)
        // Remove leading slash from search_dir if present
        searchDir = strings.TrimPrefix(searchDir, "/")
        
        // Check for path traversal
        if strings.Contains(searchDir, "..") {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
        }
        
        baseDir = filepath.Join(baseDir, searchDir)
    }

    // Collect matching files
    files := []string{}
    
    // Walk through the directory
    err := filepath.WalkDir(baseDir, func(path string, d fs.DirEntry, err error) error {
        if err != nil {
            // If the base directory doesn't exist, just return empty results
            return nil
        }
        
        // Skip directories
        if d.IsDir() {
            return nil
        }
        
        // Check if file matches criteria
        matches := false
        
        // If no criteria specified, include all files
        if (req.SearchFilename == nil || *req.SearchFilename == "") && 
           (req.SearchContent == nil || *req.SearchContent == "") {
            matches = true
        } else {
            // Check filename if specified
            if req.SearchFilename != nil && *req.SearchFilename != "" {
                if strings.Contains(d.Name(), *req.SearchFilename) {
                    matches = true
                }
            }
            
            // Check content only if not already matched and content search is specified
            if !matches && req.SearchContent != nil && *req.SearchContent != "" {
                content, err := os.ReadFile(path)
                if err == nil && strings.Contains(string(content), *req.SearchContent) {
                    matches = true
                }
            }
        }
        
        // Add to results if matches
        if matches {
            files = append(files, path)
        }
        
        return nil
    })
    
    if err != nil {
        // If there's an error walking the directory, return empty results
        // files is already initialized as empty slice
    }
    
    return c.JSON(SearchResponse{Files: files})
}