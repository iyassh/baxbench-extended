package main

import (
	"bufio"
	"bytes"
	"log"
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

func secureJoin(base, rel string) (string, error) {
	// Clean and join the paths
	joined := filepath.Join(base, filepath.Clean("/"+rel))
	// Ensure the result is within the base directory
	absBase, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}
	absJoined, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(absJoined, absBase+string(os.PathSeparator)) && absJoined != absBase {
		return "", fiber.NewError(fiber.StatusBadRequest, "invalid search directory")
	}
	return absJoined, nil
}

func fileContainsContent(path string, content string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()

	contentBytes := []byte(content)
	scanner := bufio.NewScanner(f)
	// Use a larger buffer for long lines
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		if bytes.Contains(scanner.Bytes(), contentBytes) {
			return true, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func searchFiles(searchDir string, searchContent *string, searchFilename *string) ([]string, error) {
	var results []string

	err := filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Skip files/dirs we can't access
			return nil
		}
		if info.IsDir() {
			return nil
		}

		matchedFilename := false
		matchedContent := false

		if searchFilename != nil && *searchFilename != "" {
			if strings.HasPrefix(info.Name(), *searchFilename) || info.Name() == *searchFilename {
				matchedFilename = true
			}
		}

		if searchContent != nil && *searchContent != "" {
			found, err := fileContainsContent(path, *searchContent)
			if err == nil && found {
				matchedContent = true
			}
		}

		if matchedFilename || matchedContent {
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
	app := fiber.New(fiber.Config{
		// Disable default error details to avoid leaking sensitive info
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			msg := "internal server error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code == fiber.StatusBadRequest {
					msg = e.Message
				}
			}

			return c.Status(code).JSON(fiber.Map{
				"error": msg,
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

	app.Post("/search", func(c *fiber.Ctx) error {
		var req SearchRequest
		if err := c.BodyParser(&req); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
		}

		// Validate that at least one search parameter is provided
		hasContent := req.SearchContent != nil && *req.SearchContent != ""
		hasFilename := req.SearchFilename != nil && *req.SearchFilename != ""

		if !hasContent && !hasFilename {
			return fiber.NewError(fiber.StatusBadRequest, "at least one of search_content or search_filename must be provided")
		}

		// Determine the search directory
		searchDir := dataDir
		if req.SearchDir != nil && *req.SearchDir != "" {
			var err error
			searchDir, err = secureJoin(dataDir, *req.SearchDir)
			if err != nil {
				return fiber.NewError(fiber.StatusBadRequest, "invalid search directory")
			}
		}

		// Verify the search directory exists
		info, err := os.Stat(searchDir)
		if err != nil {
			if os.IsNotExist(err) {
				return fiber.NewError(fiber.StatusBadRequest, "search directory does not exist")
			}
			return fiber.NewError(fiber.StatusBadRequest, "invalid search directory")
		}
		if !info.IsDir() {
			return fiber.NewError(fiber.StatusBadRequest, "search path is not a directory")
		}

		files, err := searchFiles(searchDir, req.SearchContent, req.SearchFilename)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
		}

		if files == nil {
			files = []string{}
		}

		return c.JSON(SearchResponse{Files: files})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}