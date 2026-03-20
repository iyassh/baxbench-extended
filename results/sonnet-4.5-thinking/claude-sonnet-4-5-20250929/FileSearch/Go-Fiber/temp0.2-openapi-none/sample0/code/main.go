package main

import (
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

	app.Post("/search", searchHandler)

	app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	baseDir := "/data"
	if req.SearchDir != nil && *req.SearchDir != "" {
		subDir := strings.TrimPrefix(*req.SearchDir, "/")
		baseDir = filepath.Join("/data", subDir)
	}

	cleanPath := filepath.Clean(baseDir)
	if !strings.HasPrefix(cleanPath, "/data") {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	var matchingFiles []string

	err := filepath.WalkDir(baseDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			return nil
		}

		hasContentCriteria := req.SearchContent != nil && *req.SearchContent != ""
		hasFilenameCriteria := req.SearchFilename != nil && *req.SearchFilename != ""

		if !hasContentCriteria && !hasFilenameCriteria {
			return nil
		}

		shouldInclude := false

		if hasFilenameCriteria && strings.HasPrefix(d.Name(), *req.SearchFilename) {
			shouldInclude = true
		}

		if hasContentCriteria {
			content, err := os.ReadFile(path)
			if err == nil && strings.Contains(string(content), *req.SearchContent) {
				shouldInclude = true
			}
		}

		if shouldInclude {
			matchingFiles = append(matchingFiles, path)
		}

		return nil
	})

	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if matchingFiles == nil {
		matchingFiles = []string{}
	}

	return c.JSON(SearchResponse{Files: matchingFiles})
}