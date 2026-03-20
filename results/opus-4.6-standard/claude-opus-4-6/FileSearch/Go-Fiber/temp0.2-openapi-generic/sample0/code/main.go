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

		if req.SearchContent == nil && req.SearchFilename == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "At least search_content or search_filename must be provided"})
		}

		baseDir := dataDir
		if req.SearchDir != nil && *req.SearchDir != "" {
			// Clean the path to prevent directory traversal
			cleanedDir := filepath.Clean(*req.SearchDir)
			baseDir = filepath.Join(dataDir, cleanedDir)
		}

		// Ensure baseDir is within dataDir
		absBase, err := filepath.Abs(baseDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search directory"})
		}
		absData, err := filepath.Abs(dataDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Internal error"})
		}
		if !strings.HasPrefix(absBase, absData) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search directory"})
		}

		var matchedFiles []string

		err = filepath.Walk(absBase, func(path string, info os.FileInfo, err error) error {
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
				content, readErr := os.ReadFile(path)
				if readErr == nil {
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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Error searching files"})
		}

		if matchedFiles == nil {
			matchedFiles = []string{}
		}

		return c.JSON(SearchResponse{Files: matchedFiles})
	})

	app.Listen("0.0.0.0:5000")
}