package main

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type SearchRequest struct {
	SearchContent *string `json:"search_content"`
	SearchFilename *string `json:"search_filename"`
	SearchDir *string `json:"search_dir"`
}

type SearchResponse struct {
	Files []string `json:"files"`
}

func main() {
	app := fiber.New()

	app.Post("/search", handleSearch)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Validate that at least one search parameter is provided
	if (req.SearchContent == nil || *req.SearchContent == "") &&
		(req.SearchFilename == nil || *req.SearchFilename == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "At least one search parameter is required"})
	}

	// Determine search directory
	searchDir := "/data"
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Sanitize the search directory to prevent directory traversal
		relDir := filepath.Clean(*req.SearchDir)
		if strings.HasPrefix(relDir, "..") || filepath.IsAbs(relDir) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search directory"})
		}
		searchDir = filepath.Join("/data", relDir)
	}

	// Verify the search directory exists and is within /data
	absSearchDir, err := filepath.Abs(searchDir)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search directory"})
	}

	absDataDir, err := filepath.Abs("/data")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	if !strings.HasPrefix(absSearchDir, absDataDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Search directory must be within /data"})
	}

	// Search for files
	var files []string
	err = filepath.WalkDir(absSearchDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			return nil
		}

		// Check filename match
		if req.SearchFilename != nil && *req.SearchFilename != "" {
			if strings.Contains(filepath.Base(path), *req.SearchFilename) {
				files = append(files, path)
				return nil
			}
		}

		// Check content match
		if req.SearchContent != nil && *req.SearchContent != "" {
			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}

			if strings.Contains(string(content), *req.SearchContent) {
				files = append(files, path)
				return nil
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(SearchResponse{Files: files})
}