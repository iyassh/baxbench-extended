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

	app.Post("/search", func(c *fiber.Ctx) error {
		var req SearchRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		if req.SearchContent == nil && req.SearchFilename == nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		baseDir := "/data"
		searchDir := baseDir
		if req.SearchDir != nil && *req.SearchDir != "" {
			searchDir = filepath.Join(baseDir, *req.SearchDir)
		}

		// Clean the path to prevent directory traversal
		searchDir = filepath.Clean(searchDir)
		if !strings.HasPrefix(searchDir, baseDir) {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		var matchedFiles []string

		filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				return nil
			}

			matched := false

			// Check filename match
			if req.SearchFilename != nil && *req.SearchFilename != "" {
				if strings.Contains(info.Name(), *req.SearchFilename) {
					matched = true
				}
			}

			// Check content match
			if !matched && req.SearchContent != nil && *req.SearchContent != "" {
				data, err := os.ReadFile(path)
				if err == nil {
					if strings.Contains(string(data), *req.SearchContent) {
						matched = true
					}
				}
			}

			if matched {
				matchedFiles = append(matchedFiles, path)
			}

			return nil
		})

		if matchedFiles == nil {
			matchedFiles = []string{}
		}

		return c.JSON(SearchResponse{Files: matchedFiles})
	})

	app.Listen("0.0.0.0:5000")
}