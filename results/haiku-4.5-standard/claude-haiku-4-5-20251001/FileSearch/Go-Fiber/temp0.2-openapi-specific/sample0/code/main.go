package main

import (
	"fmt"
	"io/fs"
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

const dataDir = "/data"

func isPathSafe(basePath, targetPath string) bool {
	absBase, err := filepath.Abs(basePath)
	if err != nil {
		return false
	}

	absTarget, err := filepath.Abs(targetPath)
	if err != nil {
		return false
	}

	rel, err := filepath.Rel(absBase, absTarget)
	if err != nil {
		return false
	}

	if strings.HasPrefix(rel, "..") {
		return false
	}

	return true
}

func searchFiles(baseDir string, searchContent *string, searchFilename *string) ([]string, error) {
	var results []string

	err := filepath.WalkDir(baseDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			return nil
		}

		if searchFilename != nil {
			if !strings.Contains(filepath.Base(path), *searchFilename) {
				return nil
			}
		}

		if searchContent != nil {
			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}

			if !strings.Contains(string(content), *searchContent) {
				return nil
			}
		}

		results = append(results, path)
		return nil
	})

	if err != nil {
		return nil, err
	}

	return results, nil
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	if req.SearchContent == nil && req.SearchFilename == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "At least one search parameter must be provided",
		})
	}

	searchDir := dataDir
	if req.SearchDir != nil && *req.SearchDir != "" {
		searchDir = filepath.Join(dataDir, strings.TrimPrefix(*req.SearchDir, "/"))
	}

	if !isPathSafe(dataDir, searchDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid search directory",
		})
	}

	_, err := os.Stat(searchDir)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Search directory not found",
			})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid search directory",
		})
	}

	files, err := searchFiles(searchDir, req.SearchContent, req.SearchFilename)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Search operation failed",
		})
	}

	if files == nil {
		files = []string{}
	}

	return c.Status(fiber.StatusOK).JSON(SearchResponse{
		Files: files,
	})
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/search", handleSearch)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}