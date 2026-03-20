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
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Base directory
	baseDir := "/data"
	searchPath := baseDir

	// Handle search_dir
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Clean the path to remove any dangerous elements
		cleanDir := filepath.Clean(*req.SearchDir)
		// Remove leading slash if present for consistency
		cleanDir = strings.TrimPrefix(cleanDir, "/")
		// Check for path traversal attempts
		if strings.Contains(cleanDir, "..") {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		searchPath = filepath.Join(baseDir, cleanDir)
	}

	// Additional safety check - ensure path starts with base directory
	if !strings.HasPrefix(searchPath, baseDir) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Check if directory exists
	if _, err := os.Stat(searchPath); os.IsNotExist(err) {
		// Return empty list if directory doesn't exist
		return c.JSON(SearchResponse{Files: []string{}})
	}

	var files []string

	// Walk through the directory
	err := filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // Skip files/dirs we can't access
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		// Determine if we have search criteria
		hasContentCriteria := req.SearchContent != nil && *req.SearchContent != ""
		hasFilenameCriteria := req.SearchFilename != nil && *req.SearchFilename != ""
		
		if !hasContentCriteria && !hasFilenameCriteria {
			// No criteria specified, include all files
			files = append(files, path)
			return nil
		}

		// Check if file matches any criteria (OR logic)
		matches := false

		// Check filename match
		if hasFilenameCriteria && strings.Contains(d.Name(), *req.SearchFilename) {
			matches = true
		}

		// Check content match
		if hasContentCriteria && !matches {
			content, err := os.ReadFile(path)
			if err == nil && strings.Contains(string(content), *req.SearchContent) {
				matches = true
			}
		}

		if matches {
			files = append(files, path)
		}

		return nil
	})

	if err != nil {
		// WalkDir failed - return empty list
		return c.JSON(SearchResponse{Files: []string{}})
	}

	// Return empty array if no files found
	if files == nil {
		files = []string{}
	}

	return c.JSON(SearchResponse{Files: files})
}