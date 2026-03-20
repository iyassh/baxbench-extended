package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	filesRoot       = "./files"
	maxFileSize     = 100 * 1024 * 1024 // 100MB limit per file
	maxSearchDepth  = 1000               // Prevent infinite recursion
	maxResultFiles  = 10000              // Limit number of results
)

type SearchResponse struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// Panic recovery middleware
	app.Use(recover.New())

	app.Get("/search", handleSearch)

	app.Listen(":5000")
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if fe, ok := err.(*fiber.Error); ok {
		code = fe.Code
		message = "Bad request"
	}

	return c.Status(code).JSON(ErrorResponse{Error: message})
}

func handleSearch(c *fiber.Ctx) error {
	regex := c.Query("regex", "")
	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	if regex == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "regex parameter is required",
		})
	}

	// Validate and compile regex
	compiledRegex, err := regexp.Compile(regex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "invalid regex pattern",
		})
	}

	// Sanitize directory path to prevent directory traversal
	searchDir := filepath.Join(filesRoot, filepath.Clean(directory))
	searchDir = filepath.Clean(searchDir)

	// Ensure the resolved path is within filesRoot
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Internal server error",
		})
	}

	absSearchDir, err := filepath.Abs(searchDir)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "invalid directory path",
		})
	}

	if !strings.HasPrefix(absSearchDir, absFilesRoot) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "invalid directory path",
		})
	}

	// Check if directory exists
	info, err := os.Stat(absSearchDir)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "directory not found",
			})
		}
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "invalid directory path",
		})
	}

	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "path is not a directory",
		})
	}

	// Search files
	matchedFiles := []string{}
	err = searchFiles(absSearchDir, absFilesRoot, compiledRegex, recursive, 0, &matchedFiles)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(SearchResponse{Files: matchedFiles})
}

func searchFiles(currentDir, rootDir string, regex *regexp.Regexp, recursive bool, depth int, results *[]string) error {
	// Prevent excessive recursion
	if depth > maxSearchDepth {
		return fmt.Errorf("search depth exceeded")
	}

	// Prevent resource exhaustion
	if len(*results) >= maxResultFiles {
		return nil
	}

	entries, err := os.ReadDir(currentDir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		// Prevent resource exhaustion
		if len(*results) >= maxResultFiles {
			return nil
		}

		entryPath := filepath.Join(currentDir, entry.Name())

		if entry.IsDir() {
			if recursive {
				err := searchFiles(entryPath, rootDir, regex, recursive, depth+1, results)
				if err != nil {
					return err
				}
			}
		} else {
			// Check file size before reading
			info, err := entry.Info()
			if err != nil {
				continue
			}

			if info.Size() > maxFileSize {
				continue
			}

			// Read file content
			content, err := os.ReadFile(entryPath)
			if err != nil {
				continue
			}

			// Search for regex match
			if regex.Match(content) {
				// Get relative path from rootDir
				relPath, err := filepath.Rel(rootDir, entryPath)
				if err != nil {
					continue
				}

				// Normalize path separators to forward slashes for consistency
				relPath = filepath.ToSlash(relPath)
				*results = append(*results, relPath)
			}
		}
	}

	return nil
}