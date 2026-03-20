package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/timeout"
)

const (
	filesRoot        = "./files"
	maxFileSize      = 10 * 1024 * 1024 // 10MB
	maxFilesPerDir   = 1000
	requestTimeout   = 30 * time.Second
)

type SearchResponse struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Internal server error",
			})
		},
		BodyLimit: 1024 * 1024, // 1MB
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Use(recover.New())
	app.Use(timeout.New(timeout.Config{
		Timeout: requestTimeout,
	}))

	app.Get("/search", handleSearch)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleSearch(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "regex parameter is required",
		})
	}

	// Validate and compile regex
	compiledRegex, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "invalid regex pattern",
		})
	}

	directoryParam := c.Query("directory", "")
	recursiveParam := c.Query("recursive", "false")

	recursive, err := strconv.ParseBool(recursiveParam)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "invalid recursive parameter",
		})
	}

	// Sanitize and validate directory path
	searchDir, err := sanitizeDirectory(directoryParam)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "invalid directory path",
		})
	}

	// Search for matching files
	matchingFiles, err := searchFiles(searchDir, compiledRegex, recursive)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "search operation failed",
		})
	}

	return c.JSON(SearchResponse{Files: matchingFiles})
}

func sanitizeDirectory(dir string) (string, error) {
	if dir == "" {
		return filesRoot, nil
	}

	// Clean the path to remove any .. or . components
	cleanDir := filepath.Clean(dir)
	
	// Ensure no path traversal attempts
	if strings.Contains(cleanDir, "..") || strings.HasPrefix(cleanDir, "/") {
		return "", fmt.Errorf("invalid directory path")
	}

	// Join with files root and clean again
	fullPath := filepath.Join(filesRoot, cleanDir)
	fullPath = filepath.Clean(fullPath)

	// Ensure the resulting path is still within filesRoot
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return "", err
	}

	absFullPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}

	if !strings.HasPrefix(absFullPath, absFilesRoot) {
		return "", fmt.Errorf("directory path outside allowed root")
	}

	// Check if directory exists
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		return "", fmt.Errorf("directory does not exist")
	}

	return fullPath, nil
}

func searchFiles(searchDir string, regex *regexp.Regexp, recursive bool) ([]string, error) {
	var matchingFiles []string
	fileCount := 0

	walkFunc := func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // Skip files with errors
		}

		// Limit number of files processed to prevent resource exhaustion
		fileCount++
		if fileCount > maxFilesPerDir {
			return fmt.Errorf("too many files in directory")
		}

		// Skip directories
		if d.IsDir() {
			if !recursive && path != searchDir {
				return filepath.SkipDir
			}
			return nil
		}

		// Check file size to prevent reading huge files
		info, err := d.Info()
		if err != nil {
			return nil // Skip files with errors
		}

		if info.Size() > maxFileSize {
			return nil // Skip files that are too large
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			return nil // Skip files that can't be read
		}

		// Check if content matches regex
		if regex.Match(content) {
			// Get relative path from search directory
			relPath, err := filepath.Rel(searchDir, path)
			if err != nil {
				return nil // Skip if can't get relative path
			}
			
			// Normalize path separators for consistent output
			relPath = filepath.ToSlash(relPath)
			matchingFiles = append(matchingFiles, relPath)
		}

		return nil
	}

	err := filepath.WalkDir(searchDir, walkFunc)
	if err != nil {
		return nil, err
	}

	return matchingFiles, nil
}