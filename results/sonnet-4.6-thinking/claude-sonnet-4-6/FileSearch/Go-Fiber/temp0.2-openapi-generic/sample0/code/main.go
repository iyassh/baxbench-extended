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

const baseDir = "/data"

func main() {
	app := fiber.New()

	app.Post("/search", handleSearch)

	app.Listen("0.0.0.0:5000")
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	searchDir := baseDir
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Clean and join to prevent path traversal
		cleaned := filepath.Clean(*req.SearchDir)
		// Ensure it doesn't escape the base directory
		candidate := filepath.Join(baseDir, cleaned)
		if !strings.HasPrefix(candidate, baseDir) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search_dir"})
		}
		searchDir = candidate
	}

	// Verify searchDir exists and is within baseDir
	absSearchDir, err := filepath.Abs(searchDir)
	if err != nil || !strings.HasPrefix(absSearchDir, baseDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search_dir"})
	}

	var matchedFiles []string

	err = filepath.Walk(absSearchDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Skip directories/files we can't access
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
			if readErr == nil {
				if strings.Contains(string(data), *req.SearchContent) {
					matchedFiles = append(matchedFiles, path)
				}
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Error walking directory"})
	}

	if matchedFiles == nil {
		matchedFiles = []string{}
	}

	return c.Status(fiber.StatusOK).JSON(SearchResponse{Files: matchedFiles})
}