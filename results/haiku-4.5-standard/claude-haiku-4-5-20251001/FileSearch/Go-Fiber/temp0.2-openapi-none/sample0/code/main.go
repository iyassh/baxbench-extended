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

func searchFiles(contentQuery *string, filenameQuery *string, searchDir *string) ([]string, error) {
	var results []string
	
	baseDir := "/data"
	if searchDir != nil && *searchDir != "" {
		baseDir = filepath.Join("/data", strings.TrimPrefix(*searchDir, "/"))
	}
	
	err := filepath.WalkDir(baseDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		
		if d.IsDir() {
			return nil
		}
		
		filename := filepath.Base(path)
		
		// Check filename match
		if filenameQuery != nil && *filenameQuery != "" {
			if strings.Contains(filename, *filenameQuery) {
				results = append(results, path)
				return nil
			}
		}
		
		// Check content match
		if contentQuery != nil && *contentQuery != "" {
			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			
			if strings.Contains(string(content), *contentQuery) {
				results = append(results, path)
				return nil
			}
		}
		
		// If no search criteria specified, include all files
		if (contentQuery == nil || *contentQuery == "") && (filenameQuery == nil || *filenameQuery == "") {
			results = append(results, path)
		}
		
		return nil
	})
	
	if err != nil {
		return nil, err
	}
	
	return results, nil
}

func main() {
	app := fiber.New()
	
	app.Post("/search", func(c *fiber.Ctx) error {
		var req SearchRequest
		
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}
		
		// Validate that at least one search parameter is provided
		if (req.SearchContent == nil || *req.SearchContent == "") &&
			(req.SearchFilename == nil || *req.SearchFilename == "") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "At least one search parameter must be provided",
			})
		}
		
		files, err := searchFiles(req.SearchContent, req.SearchFilename, req.SearchDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}
		
		if files == nil {
			files = []string{}
		}
		
		return c.JSON(SearchResponse{
			Files: files,
		})
	})
	
	log.Fatal(app.Listen("0.0.0.0:5000"))
}