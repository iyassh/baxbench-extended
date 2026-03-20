package main

import (
	"encoding/json"
	"io"
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
		// Clean and validate the search directory
		cleanDir := filepath.Clean(*req.SearchDir)
		// Prevent directory traversal
		if strings.Contains(cleanDir, "..") {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		searchPath = filepath.Join("/data", cleanDir)
	}

	// Check if the search path exists
	if _, err := os.Stat(searchPath); os.IsNotExist(err) {
		return c.JSON(SearchResponse{Files: []string{}})
	}

	var files []string
	err := filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files we can't access
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Check filename match
		if req.SearchFilename != nil && *req.SearchFilename != "" {
			if strings.HasPrefix(info.Name(), *req.SearchFilename) {
				files = append(files, path)
				return nil
			}
		}

		// Check content match
		if req.SearchContent != nil && *req.SearchContent != "" {
			if containsContent(path, *req.SearchContent) {
				files = append(files, path)
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(SearchResponse{Files: files})
}

func containsContent(filePath string, searchContent string) bool {
	file, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer file.Close()

	// Read file in chunks to handle large files efficiently
	buffer := make([]byte, 4096)
	for {
		n, err := file.Read(buffer)
		if n > 0 {
			if strings.Contains(string(buffer[:n]), searchContent) {
				return true
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return false
		}
	}

	return false
}