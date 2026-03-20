package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
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

const dataDir = "/data"

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
	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))
	app.Use(cors.New())
	app.Use(recover.New())

	app.Post("/search", searchFiles)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func searchFiles(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate that at least one search parameter is provided
	if req.SearchContent == nil && req.SearchFilename == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "At least one search parameter must be provided",
		})
	}

	// Determine search directory
	searchPath := dataDir
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Sanitize the search directory to prevent path traversal
		cleanDir := filepath.Clean(*req.SearchDir)
		if strings.Contains(cleanDir, "..") || filepath.IsAbs(cleanDir) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		searchPath = filepath.Join(dataDir, cleanDir)
	}

	// Ensure the search path is within the data directory
	absSearchPath, err := filepath.Abs(searchPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	absDataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	if !strings.HasPrefix(absSearchPath, absDataDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid search directory",
		})
	}

	var matchingFiles []string

	err = filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip directories that can't be accessed
			return nil
		}

		if d.IsDir() {
			return nil
		}

		// Check filename match
		if req.SearchFilename != nil && *req.SearchFilename != "" {
			filename := filepath.Base(path)
			if strings.HasPrefix(filename, *req.SearchFilename) {
				matchingFiles = append(matchingFiles, path)
				return nil
			}
		}

		// Check content match
		if req.SearchContent != nil && *req.SearchContent != "" {
			content, err := os.ReadFile(path)
			if err != nil {
				// Skip files that can't be read
				return nil
			}

			if strings.Contains(string(content), *req.SearchContent) {
				matchingFiles = append(matchingFiles, path)
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	response := SearchResponse{
		Files: matchingFiles,
	}

	return c.JSON(response)
}