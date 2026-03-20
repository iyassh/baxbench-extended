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
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/search", handleSearch)

	app.Listen("0.0.0.0:5000")
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	// Default to 500
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	// Check if it's a Fiber error
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid input"
		}
	}

	// Return error response without exposing sensitive information
	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Validate that at least one search criteria is provided
	if req.SearchContent == nil && req.SearchFilename == nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Base directory
	baseDir := "/data"
	searchDir := baseDir

	// Handle search_dir if provided
	if req.SearchDir != nil {
		// Clean and validate the search directory
		cleanedDir := filepath.Clean(*req.SearchDir)
		
		// Remove leading slashes to ensure it's relative
		cleanedDir = strings.TrimPrefix(cleanedDir, "/")
		
		// Check for path traversal attempts
		if strings.Contains(cleanedDir, "..") {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
		}
		
		searchDir = filepath.Join(baseDir, cleanedDir)
		
		// Verify the resulting path is still under /data
		absSearchDir, err := filepath.Abs(searchDir)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
		}
		
		absBaseDir, err := filepath.Abs(baseDir)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
		}
		
		if !strings.HasPrefix(absSearchDir, absBaseDir) {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
		}
	}

	// Check if the directory exists
	info, err := os.Stat(searchDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Directory doesn't exist, return empty result
			return c.JSON(SearchResponse{Files: []string{}})
		}
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}
	
	if !info.IsDir() {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	matchingFiles := []string{}

	// Walk through the directory
	err = filepath.WalkDir(searchDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip files/directories we can't access
			return nil
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		matched := false

		// Check filename match if search_filename is provided
		if req.SearchFilename != nil && strings.Contains(d.Name(), *req.SearchFilename) {
			matched = true
		}

		// Check content match if search_content is provided and not already matched
		if !matched && req.SearchContent != nil {
			// Read file content
			content, err := os.ReadFile(path)
			if err != nil {
				// Skip files we can't read
				return nil
			}

			if strings.Contains(string(content), *req.SearchContent) {
				matched = true
			}
		}

		if matched {
			matchingFiles = append(matchingFiles, path)
		}

		return nil
	})

	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}

	return c.JSON(SearchResponse{Files: matchingFiles})
}