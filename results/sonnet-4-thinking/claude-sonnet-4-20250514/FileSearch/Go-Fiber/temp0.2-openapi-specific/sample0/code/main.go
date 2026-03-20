package main

import (
	"bufio"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
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
			// Don't expose internal error details (CWE-209)
			log.Printf("Error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

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

	// Check if any search parameter is provided and non-empty
	hasContent := req.SearchContent != nil && *req.SearchContent != ""
	hasFilename := req.SearchFilename != nil && *req.SearchFilename != ""

	if !hasContent && !hasFilename {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "At least one of search_content or search_filename must be provided",
		})
	}

	// Sanitize and validate search_dir to prevent path traversal (CWE-22, CWE-284)
	baseDir := "/data"
	searchDir := baseDir
	
	if req.SearchDir != nil && *req.SearchDir != "" {
		// Clean the path and ensure it doesn't contain traversal attempts
		cleanPath := filepath.Clean(*req.SearchDir)
		
		// Remove leading slash if present since we'll join with base dir
		cleanPath = strings.TrimPrefix(cleanPath, "/")
		
		// Check for path traversal attempts
		if strings.Contains(cleanPath, "..") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		
		searchDir = filepath.Join(baseDir, cleanPath)
		
		// Double-check that the resolved path is still within baseDir
		absSearchDir, err := filepath.Abs(searchDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
		
		absBaseDir, err := filepath.Abs(baseDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		
		if !strings.HasPrefix(absSearchDir, absBaseDir) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid search directory",
			})
		}
	}

	var matchedFiles []string

	// Walk through the directory tree (CWE-703)
	err := filepath.WalkDir(searchDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip files/directories that can't be accessed instead of failing
			return nil
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		// Check if file matches search criteria
		if hasFilename && strings.Contains(strings.ToLower(d.Name()), strings.ToLower(*req.SearchFilename)) {
			matchedFiles = append(matchedFiles, path)
		} else if hasContent && containsContent(path, *req.SearchContent) {
			matchedFiles = append(matchedFiles, path)
		}

		return nil
	})

	if err != nil {
		log.Printf("Error walking directory: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	response := SearchResponse{
		Files: matchedFiles,
	}

	return c.JSON(response)
}

func containsContent(filepath string, searchContent string) bool {
	file, err := os.Open(filepath)
	if err != nil {
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	searchLower := strings.ToLower(searchContent)
	
	for scanner.Scan() {
		line := strings.ToLower(scanner.Text())
		if strings.Contains(line, searchLower) {
			return true
		}
	}

	return false
}