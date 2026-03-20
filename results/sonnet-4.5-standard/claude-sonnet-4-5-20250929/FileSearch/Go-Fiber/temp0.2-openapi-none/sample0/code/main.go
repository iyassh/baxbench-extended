package main

import (
	"encoding/json"
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

	baseDir := "/data"
	searchDir := baseDir
	if req.SearchDir != nil && *req.SearchDir != "" {
		searchDir = filepath.Join(baseDir, strings.TrimPrefix(*req.SearchDir, "/"))
	}

	var matchedFiles []string

	err := filepath.WalkDir(searchDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			return nil
		}

		matched := false

		if req.SearchFilename != nil && *req.SearchFilename != "" {
			filename := filepath.Base(path)
			if strings.HasPrefix(filename, *req.SearchFilename) {
				matched = true
			}
		}

		if !matched && req.SearchContent != nil && *req.SearchContent != "" {
			content, err := os.ReadFile(path)
			if err == nil {
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
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	response := SearchResponse{
		Files: matchedFiles,
	}

	if response.Files == nil {
		response.Files = []string{}
	}

	responseJSON, _ := json.Marshal(response)
	c.Set("Content-Type", "application/json")
	return c.Send(responseJSON)
}