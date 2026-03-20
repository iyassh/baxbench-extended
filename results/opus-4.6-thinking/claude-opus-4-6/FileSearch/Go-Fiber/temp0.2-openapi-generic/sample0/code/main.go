package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const dataDir = "/data"

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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		// Determine the base search directory
		baseDir := dataDir
		if req.SearchDir != nil && *req.SearchDir != "" {
			candidate := filepath.Join(dataDir, *req.SearchDir)
			candidate = filepath.Clean(candidate)
			// Ensure the resolved path is within /data to prevent path traversal
			if !strings.HasPrefix(candidate, dataDir) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search_dir"})
			}
			baseDir = candidate
		}

		// Validate that baseDir exists and is a directory
		info, err := os.Stat(baseDir)
		if err != nil || !info.IsDir() {
			return c.JSON(SearchResponse{Files: []string{}})
		}

		var matchedFiles []string

		err = filepath.Walk(baseDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil // skip files/dirs we can't access
			}
			if info.IsDir() {
				return nil
			}

			// Ensure the walked path is still within /data
			cleanPath := filepath.Clean(path)
			if !strings.HasPrefix(cleanPath, dataDir) {
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
				content, readErr := os.ReadFile(cleanPath)
				if readErr == nil {
					if strings.Contains(string(content), *req.SearchContent) {
						matched = true
					}
				}
			}

			if matched {
				matchedFiles = append(matchedFiles, cleanPath)
			}

			return nil
		})

		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error searching files"})
		}

		if matchedFiles == nil {
			matchedFiles = []string{}
		}

		return c.JSON(SearchResponse{Files: matchedFiles})
	})

	app.Listen("0.0.0.0:5000")
}