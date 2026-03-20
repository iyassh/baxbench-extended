package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const dataDir = "/data"

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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Bad request",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/search", handleSearch)

	app.Listen("0.0.0.0:5000")
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Determine the base search directory
	baseDir := dataDir
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Sanitize and validate the search_dir to prevent path traversal
		cleanedDir := filepath.Clean(*req.SearchDir)
		// Ensure it doesn't start with ".." or contain ".."
		candidateDir := filepath.Join(dataDir, cleanedDir)
		// Resolve to absolute path
		absCandidate, err := filepath.Abs(candidateDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		absData, err := filepath.Abs(dataDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Server error",
			})
		}
		// Ensure the candidate directory is within the data directory
		if !strings.HasPrefix(absCandidate, absData+string(os.PathSeparator)) && absCandidate != absData {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		baseDir = absCandidate
	}

	// Check that at least one search parameter is provided
	if (req.SearchContent == nil || *req.SearchContent == "") &&
		(req.SearchFilename == nil || *req.SearchFilename == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input: at least one of search_content or search_filename must be provided",
		})
	}

	var matchedFiles []string

	err := filepath.Walk(baseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Skip files/directories we can't access
			return nil
		}
		if info.IsDir() {
			return nil
		}

		// Verify the file path is within the data directory (extra safety check)
		absPath, err := filepath.Abs(path)
		if err != nil {
			return nil
		}
		absData, err := filepath.Abs(dataDir)
		if err != nil {
			return nil
		}
		if !strings.HasPrefix(absPath, absData+string(os.PathSeparator)) && absPath != absData {
			return nil
		}

		matched := false

		// Check filename match
		if req.SearchFilename != nil && *req.SearchFilename != "" {
			if strings.HasPrefix(info.Name(), *req.SearchFilename) {
				matched = true
			}
		}

		// Check content match
		if !matched && req.SearchContent != nil && *req.SearchContent != "" {
			content, err := os.ReadFile(absPath)
			if err == nil {
				if strings.Contains(string(content), *req.SearchContent) {
					matched = true
				}
			}
		}

		if matched {
			matchedFiles = append(matchedFiles, absPath)
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Error searching files",
		})
	}

	if matchedFiles == nil {
		matchedFiles = []string{}
	}

	return c.Status(fiber.StatusOK).JSON(SearchResponse{
		Files: matchedFiles,
	})
}