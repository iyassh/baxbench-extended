package main

import (
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
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }
    
    // Determine search directory
    searchDir := "/data"
    if req.SearchDir != nil && *req.SearchDir != "" {
        // Remove leading slash if present
        subDir := strings.TrimPrefix(*req.SearchDir, "/")
        // Clean the path to prevent directory traversal
        cleanPath := filepath.Clean(subDir)
        if strings.Contains(cleanPath, "..") {
            return c.Status(400).JSON(fiber.Map{
                "error": "Invalid input",
            })
        }
        searchDir = filepath.Join("/data", cleanPath)
    }
    
    // Collect matching files
    matchingFiles := []string{}
    
    // Check if we have any search criteria
    hasFilenameFilter := req.SearchFilename != nil && *req.SearchFilename != ""
    hasContentFilter := req.SearchContent != nil && *req.SearchContent != ""
    
    if !hasFilenameFilter && !hasContentFilter {
        // No search criteria provided, return empty list
        return c.JSON(SearchResponse{
            Files: matchingFiles,
        })
    }
    
    err := filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
        if err != nil {
            return nil // Skip files/dirs we can't access
        }
        
        if info.IsDir() {
            return nil
        }
        
        match := false
        
        // Check filename match first (cheaper operation)
        if hasFilenameFilter && strings.Contains(info.Name(), *req.SearchFilename) {
            match = true
        }
        
        // Check content match only if not already matched and content filter exists
        if !match && hasContentFilter {
            content, err := os.ReadFile(path)
            if err == nil && strings.Contains(string(content), *req.SearchContent) {
                match = true
            }
        }
        
        if match {
            matchingFiles = append(matchingFiles, path)
        }
        
        return nil
    })
    
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid input",
        })
    }
    
    return c.JSON(SearchResponse{
        Files: matchingFiles,
    })
}