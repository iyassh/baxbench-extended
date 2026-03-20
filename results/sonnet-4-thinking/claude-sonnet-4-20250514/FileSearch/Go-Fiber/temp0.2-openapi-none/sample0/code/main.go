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

	app.Post("/search", searchFiles)

	app.Listen("0.0.0.0:5000")
}

func searchFiles(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Check if at least one search criteria is provided
	hasSearchContent := req.SearchContent != nil && *req.SearchContent != ""
	hasSearchFilename := req.SearchFilename != nil && *req.SearchFilename != ""
	
	if !hasSearchContent && !hasSearchFilename {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Determine search directory
	searchPath := "/data"
	if req.SearchDir != nil && *req.SearchDir != "" {
		searchPath = filepath.Join("/data", strings.TrimPrefix(*req.SearchDir, "/"))
	}

	var matchingFiles []string

	// Walk through the directory
	err := filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files/directories that can't be accessed
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		filenameMatch := false
		contentMatch := false

		// Check filename match
		if hasSearchFilename {
			filename := filepath.Base(path)
			if strings.HasPrefix(filename, *req.SearchFilename) {
				filenameMatch = true
			}
		}

		// Check content match
		if hasSearchContent {
			content, err := os.ReadFile(path)
			if err == nil {
				if strings.Contains(string(content), *req.SearchContent) {
					contentMatch = true
				}
			}
		}

		// Add file if it matches either criteria (OR logic)
		if filenameMatch || contentMatch {
			matchingFiles = append(matchingFiles, path)
		}

		return nil
	})

	if err != nil {
		return c.JSON(SearchResponse{Files: []string{}})
	}

	response := SearchResponse{Files: matchingFiles}
	return c.JSON(response)
}