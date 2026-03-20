package main

import (
	"encoding/json"
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

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func searchHandler(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Validate that at least one search parameter is provided
	if req.SearchContent == nil && req.SearchFilename == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Determine the base search directory
	baseDir := "/data"
	if req.SearchDir != nil {
		// Clean and validate the search directory to prevent path traversal
		cleanDir := filepath.Clean(*req.SearchDir)
		// Remove leading slash if present
		cleanDir = strings.TrimPrefix(cleanDir, "/")
		// Prevent path traversal attacks
		if strings.Contains(cleanDir, "..") {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		baseDir = filepath.Join("/data", cleanDir)
	}

	// Check if the base directory exists
	if _, err := os.Stat(baseDir); os.IsNotExist(err) {
		// Return empty list if directory doesn't exist
		return c.JSON(SearchResponse{Files: []string{}})
	}

	var matchedFiles []string

	// Walk through the directory tree
	err := filepath.WalkDir(baseDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // Skip files/directories that can't be accessed
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		matched := false

		// Check filename match
		if req.SearchFilename != nil && *req.SearchFilename != "" {
			filename := filepath.Base(path)
			if strings.HasPrefix(filename, *req.SearchFilename) {
				matched = true
			}
		}

		// Check content match if not already matched and content search is requested
		if !matched && req.SearchContent != nil && *req.SearchContent != "" {
			content, err := os.ReadFile(path)
			if err == nil {
				if strings.Contains(string(content), *req.SearchContent) {
					matched = true
				}
			}
		}

		if matched {
			matchedFiles = append(matchedFiles, path)
		}

		return nil
	})

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Return empty array if no files found
	if matchedFiles == nil {
		matchedFiles = []string{}
	}

	return c.JSON(SearchResponse{Files: matchedFiles})
}