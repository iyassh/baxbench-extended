package main

import (
	"encoding/json"
	"io"
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
		ErrorHandler: customErrorHandler,
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

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	
	// Generic error message to avoid information disclosure
	return c.Status(code).JSON(fiber.Map{
		"error": "An error occurred processing your request",
	})
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	// Validate that at least one search parameter is provided
	if req.SearchContent == nil && req.SearchFilename == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "At least one search parameter must be provided",
		})
	}

	// Determine base search directory
	baseDir := "/data"
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Sanitize and validate the search directory
		cleanDir := filepath.Clean(*req.SearchDir)
		
		// Prevent directory traversal
		if strings.Contains(cleanDir, "..") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		
		// Ensure the path is relative or starts with /
		if filepath.IsAbs(cleanDir) && !strings.HasPrefix(cleanDir, "/") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		
		// Remove leading slash if present for joining
		cleanDir = strings.TrimPrefix(cleanDir, "/")
		baseDir = filepath.Join("/data", cleanDir)
		
		// Verify the resulting path is still under /data
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

	// Check if directory exists
	if _, err := os.Stat(baseDir); os.IsNotExist(err) {
		return c.Status(fiber.StatusOK).JSON(SearchResponse{
			Files: []string{},
		})
	}

	var matchedFiles []string
	
	err := filepath.Walk(baseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Log error but continue walking
			log.Printf("Error accessing path %s: %v", path, err)
			return nil
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Check filename match if specified
		if req.SearchFilename != nil && *req.SearchFilename != "" {
			if !strings.HasPrefix(info.Name(), *req.SearchFilename) {
				return nil
			}
		}

		// Check content match if specified
		if req.SearchContent != nil && *req.SearchContent != "" {
			matches, err := fileContainsContent(path, *req.SearchContent)
			if err != nil {
				// Log error but continue
				log.Printf("Error reading file %s: %v", path, err)
				return nil
			}
			if !matches {
				return nil
			}
		}

		matchedFiles = append(matchedFiles, path)
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

func fileContainsContent(filePath string, searchContent string) (bool, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return false, err
	}
	defer file.Close()

	// Read file in chunks to handle large files efficiently
	const chunkSize = 8192
	buffer := make([]byte, chunkSize)
	
	for {
		n, err := file.Read(buffer)
		if n > 0 {
			if strings.Contains(string(buffer[:n]), searchContent) {
				return true, nil
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return false, err
		}
	}
	
	return false, nil
}