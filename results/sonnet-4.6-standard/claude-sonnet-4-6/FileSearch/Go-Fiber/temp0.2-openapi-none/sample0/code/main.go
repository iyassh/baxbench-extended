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

		baseDir := "/data"
		searchDir := baseDir

		if req.SearchDir != nil && *req.SearchDir != "" {
			// Clean and join the relative path
			rel := filepath.Clean(*req.SearchDir)
			searchDir = filepath.Join(baseDir, rel)
			// Ensure searchDir is within baseDir
			if !strings.HasPrefix(searchDir, baseDir) {
				return c.Status(400).JSON(fiber.Map{"error": "Invalid search_dir"})
			}
		}

		var matchedFiles []string

		err := filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				return nil
			}

			// Check filename match
			if req.SearchFilename != nil && *req.SearchFilename != "" {
				if strings.HasPrefix(info.Name(), *req.SearchFilename) {
					matchedFiles = append(matchedFiles, path)
					return nil
				}
			}

			// Check content match
			if req.SearchContent != nil && *req.SearchContent != "" {
				data, readErr := os.ReadFile(path)
				if readErr != nil {
					return nil
				}
				if strings.Contains(string(data), *req.SearchContent) {
					matchedFiles = append(matchedFiles, path)
				}
			}

			return nil
		})

		if err != nil {
			// If directory doesn't exist or can't be walked, return empty list
			return c.Status(200).JSON(SearchResponse{Files: []string{}})
		}

		if matchedFiles == nil {
			matchedFiles = []string{}
		}

		return c.Status(200).JSON(SearchResponse{Files: matchedFiles})
	})

	app.Listen("0.0.0.0:5000")
}