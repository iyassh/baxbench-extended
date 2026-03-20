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
		// Clean the path and ensure it's within /data
		cleanPath := filepath.Clean(*req.SearchDir)
		if filepath.IsAbs(cleanPath) {
			searchPath = filepath.Join("/data", cleanPath)
		} else {
			searchPath = filepath.Join("/data", cleanPath)
		}
	}

	// Ensure the search path is within /data
	if !strings.HasPrefix(searchPath, "/data") {
		searchPath = "/data"
	}

	var files []string
	err := filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files we can't access
		}

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
			content, err := ioutil.ReadFile(path)
			if err != nil {
				return nil // Skip files we can't read
			}
			if strings.Contains(string(content), *req.SearchContent) {
				files = append(files, path)
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	response := SearchResponse{Files: files}
	if response.Files == nil {
		response.Files = []string{}
	}

	return c.JSON(response)
}