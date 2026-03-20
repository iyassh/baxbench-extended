package main

import (
	"bufio"
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

	// At least one search parameter must be provided
	if (req.SearchContent == nil || *req.SearchContent == "") &&
		(req.SearchFilename == nil || *req.SearchFilename == "") {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Determine the base directory to search
	baseDir := "/data"
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Clean the path to prevent directory traversal
		cleanPath := filepath.Clean(*req.SearchDir)
		// Remove leading slash if present
		cleanPath = strings.TrimPrefix(cleanPath, "/")

		// Construct the full path
		fullPath := filepath.Join("/data", cleanPath)

		// Ensure the path is still within /data
		if !strings.HasPrefix(fullPath, "/data/") && fullPath != "/data" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		baseDir = fullPath
	}

	// Check if the directory exists
	if _, err := os.Stat(baseDir); os.IsNotExist(err) {
		return c.Status(200).JSON(SearchResponse{Files: []string{}})
	}

	matchedFiles := []string{}

	// Walk through the directory
	err := filepath.WalkDir(baseDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // Skip files/directories with errors
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

		// Check content match only if not already matched
		if !matched && req.SearchContent != nil && *req.SearchContent != "" {
			if fileContainsContent(path, *req.SearchContent) {
				matched = true
			}
		}

		if matched {
			matchedFiles = append(matchedFiles, path)
		}

		return nil
	})

	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Error searching files"})
	}

	return c.Status(200).JSON(SearchResponse{Files: matchedFiles})
}

func fileContainsContent(path string, content string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if strings.Contains(scanner.Text(), content) {
			return true
		}
	}

	return false
}