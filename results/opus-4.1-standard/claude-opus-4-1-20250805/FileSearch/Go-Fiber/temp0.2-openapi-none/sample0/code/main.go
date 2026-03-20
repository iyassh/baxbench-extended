package main

import (
	"encoding/json"
	"io/ioutil"
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

	// Validate that at least one search parameter is provided
	if req.SearchContent == nil && req.SearchFilename == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Determine the search directory
	searchPath := "/data"
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Clean the path and ensure it's relative
		cleanDir := filepath.Clean(*req.SearchDir)
		// Remove leading slash if present
		cleanDir = strings.TrimPrefix(cleanDir, "/")
		searchPath = filepath.Join("/data", cleanDir)
	}

	// Check if the search path exists
	if _, err := os.Stat(searchPath); os.IsNotExist(err) {
		return c.JSON(SearchResponse{Files: []string{}})
	}

	var matchedFiles []string

	// Walk through the directory
	err := filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files/directories that can't be accessed
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

		// Check content match if not already matched and content search is requested
		if !matched && req.SearchContent != nil && *req.SearchContent != "" {
			content, err := ioutil.ReadFile(path)
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

	return c.JSON(SearchResponse{Files: matchedFiles})
}