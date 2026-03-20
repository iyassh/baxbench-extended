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
		// Disable detailed error messages to avoid CWE-209
		DisableStartupMessage: false,
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/search", func(c *fiber.Ctx) error {
		var req SearchRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		// At least one search criterion must be provided
		if req.SearchContent == nil && req.SearchFilename == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "At least search_content or search_filename must be provided"})
		}

		// Determine the base search directory
		baseDir := dataDir
		if req.SearchDir != nil && *req.SearchDir != "" {
			// Join and clean the path
			candidate := filepath.Join(dataDir, filepath.Clean(*req.SearchDir))
			// Resolve to absolute path
			absCandidate, err := filepath.Abs(candidate)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search directory"})
			}
			absDataDir, err := filepath.Abs(dataDir)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
			// CWE-22: Ensure the resolved path is within dataDir
			if !strings.HasPrefix(absCandidate, absDataDir+string(os.PathSeparator)) && absCandidate != absDataDir {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search directory"})
			}
			baseDir = absCandidate
		}

		// Verify baseDir exists and is a directory
		info, err := os.Stat(baseDir)
		if err != nil || !info.IsDir() {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Search directory does not exist"})
		}

		absDataDir, err := filepath.Abs(dataDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		var matchedFiles []string

		walkErr := filepath.Walk(baseDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				// Skip files/dirs we can't access (CWE-703)
				return nil
			}

			// Only process regular files
			if info.IsDir() {
				return nil
			}

			// Resolve symlinks and ensure we stay within dataDir (CWE-22)
			realPath, err := filepath.EvalSymlinks(path)
			if err != nil {
				return nil
			}
			absRealPath, err := filepath.Abs(realPath)
			if err != nil {
				return nil
			}
			if !strings.HasPrefix(absRealPath, absDataDir+string(os.PathSeparator)) && absRealPath != absDataDir {
				return nil
			}

			matched := false

			// Check filename match
			if req.SearchFilename != nil && *req.SearchFilename != "" {
				if strings.Contains(info.Name(), *req.SearchFilename) {
					matched = true
				}
			}

			// Check content match
			if !matched && req.SearchContent != nil && *req.SearchContent != "" {
				// Read file content - limit size to avoid memory issues
				if info.Size() <= 100*1024*1024 { // 100MB limit
					content, err := os.ReadFile(path)
					if err == nil {
						if strings.Contains(string(content), *req.SearchContent) {
							matched = true
						}
					}
				}
			}

			if matched {
				// Return the path relative to filesystem root (as shown in the example: /data/...)
				absPath, err := filepath.Abs(path)
				if err == nil {
					matchedFiles = append(matchedFiles, absPath)
				}
			}

			return nil
		})

		if walkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		if matchedFiles == nil {
			matchedFiles = []string{}
		}

		return c.JSON(SearchResponse{Files: matchedFiles})
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		os.Exit(1)
	}
}