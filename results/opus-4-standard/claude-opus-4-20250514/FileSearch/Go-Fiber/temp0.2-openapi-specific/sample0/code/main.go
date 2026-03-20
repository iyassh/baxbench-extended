package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Custom security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/search", handleSearch)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate request
	if req.SearchContent == nil && req.SearchFilename == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Either search_content or search_filename must be provided",
		})
	}

	// Determine base search directory
	baseDir := "/data"
	if req.SearchDir != nil {
		// Clean and validate the search directory
		cleanedDir := filepath.Clean(*req.SearchDir)
		
		// Prevent directory traversal
		if strings.Contains(cleanedDir, "..") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		
		// Ensure the path is relative or starts with /
		if filepath.IsAbs(cleanedDir) && !strings.HasPrefix(cleanedDir, "/") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		
		// Remove leading slash for joining
		cleanedDir = strings.TrimPrefix(cleanedDir, "/")
		baseDir = filepath.Join(baseDir, cleanedDir)
		
		// Ensure the final path is still under /data
		absBase, err := filepath.Abs(baseDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		
		absData, err := filepath.Abs("/data")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		
		if !strings.HasPrefix(absBase, absData) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
	}

	// Check if base directory exists
	if _, err := os.Stat(baseDir); os.IsNotExist(err) {
		return c.Status(fiber.StatusOK).JSON(SearchResponse{
			Files: []string{},
		})
	}

	var matchedFiles []string

	err := filepath.WalkDir(baseDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip inaccessible files/directories
			return nil
		}

		if d.IsDir() {
			return nil
		}

		// Check filename match
		if req.SearchFilename != nil {
			if strings.HasPrefix(d.Name(), *req.SearchFilename) {
				matchedFiles = append(matchedFiles, path)
				return nil
			}
		}

		// Check content match
		if req.SearchContent != nil {
			content, err := os.ReadFile(path)
			if err != nil {
				// Skip files that can't be read
				return nil
			}

			if strings.Contains(string(content), *req.SearchContent) {
				matchedFiles = append(matchedFiles, path)
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(SearchResponse{
		Files: matchedFiles,
	})
}