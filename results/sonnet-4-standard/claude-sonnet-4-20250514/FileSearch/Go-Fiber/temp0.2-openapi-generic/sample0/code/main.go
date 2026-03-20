package main

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
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

	app.Use(cors.New())

	app.Post("/search", handleSearch)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if req.SearchContent == nil && req.SearchFilename == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Either search_content or search_filename must be provided"})
	}

	baseDir := "/data"
	searchDir := baseDir
	
	if req.SearchDir != nil && *req.SearchDir != "" {
		searchPath := strings.TrimPrefix(*req.SearchDir, "/")
		searchDir = filepath.Join(baseDir, searchPath)
	}

	cleanSearchDir := filepath.Clean(searchDir)
	if !strings.HasPrefix(cleanSearchDir, baseDir) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid search directory"})
	}

	var matchingFiles []string

	err := filepath.Walk(cleanSearchDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() {
			return nil
		}

		if req.SearchFilename != nil && *req.SearchFilename != "" {
			if strings.HasPrefix(filepath.Base(path), *req.SearchFilename) {
				matchingFiles = append(matchingFiles, path)
				return nil
			}
		}

		if req.SearchContent != nil && *req.SearchContent != "" {
			if containsContent(path, *req.SearchContent) {
				matchingFiles = append(matchingFiles, path)
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Error searching files"})
	}

	response := SearchResponse{
		Files: matchingFiles,
	}

	return c.JSON(response)
}

func containsContent(filePath, searchContent string) bool {
	file, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if strings.Contains(scanner.Text(), searchContent) {
			return true
		}
	}

	return false
}