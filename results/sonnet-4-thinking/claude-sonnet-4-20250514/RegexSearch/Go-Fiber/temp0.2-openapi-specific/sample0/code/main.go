package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type SearchResponse struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

const (
	maxFileSize     = 10 * 1024 * 1024 // 10MB per file
	maxFilesChecked = 1000              // Maximum number of files to check
	filesRoot       = "./files"
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			
			return c.Status(code).JSON(ErrorResponse{
				Error: "Internal server error",
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

	// Recovery middleware
	app.Use(recover.New())

	app.Get("/search", searchHandler)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func searchHandler(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "regex parameter is required",
		})
	}

	// Compile regex
	regex, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid regex pattern",
		})
	}

	directoryParam := c.Query("directory", "")
	recursive := c.Query("recursive", "false") == "true"

	// Sanitize directory path to prevent path traversal
	searchDir := filesRoot
	if directoryParam != "" {
		// Clean and validate the directory path
		cleanDir := filepath.Clean(directoryParam)
		
		// Prevent path traversal attacks
		if strings.Contains(cleanDir, "..") || filepath.IsAbs(cleanDir) {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid directory path",
			})
		}
		
		searchDir = filepath.Join(filesRoot, cleanDir)
	}

	// Check if search directory is within allowed bounds
	absSearchDir, err := filepath.Abs(searchDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Internal server error",
		})
	}

	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Internal server error",
		})
	}

	// Use filepath.Rel to check if search directory is within files root
	relPath, err := filepath.Rel(absFilesRoot, absSearchDir)
	if err != nil || strings.HasPrefix(relPath, "..") {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid directory path",
		})
	}

	// Check if directory exists
	if _, err := os.Stat(searchDir); os.IsNotExist(err) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Directory does not exist",
		})
	}

	files, err := searchFiles(regex, searchDir, recursive)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Internal server error",
		})
	}

	return c.JSON(SearchResponse{Files: files})
}

func searchFiles(regex *regexp.Regexp, searchDir string, recursive bool) ([]string, error) {
	var matchedFiles []string
	filesChecked := 0

	err := filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Skip files with permission errors or other issues
			return nil
		}

		// Limit number of files processed to prevent DoS
		filesChecked++
		if filesChecked > maxFilesChecked {
			return fmt.Errorf("too many files to process")
		}

		// Skip directories
		if info.IsDir() {
			// If not recursive, skip subdirectories
			if !recursive && path != searchDir {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip files that are too large
		if info.Size() > maxFileSize {
			return nil
		}

		// Read file content with size limit
		file, err := os.Open(path)
		if err != nil {
			// Skip files that cannot be opened
			return nil
		}
		defer file.Close()

		// Limit how much we read
		content, err := io.ReadAll(io.LimitReader(file, maxFileSize))
		if err != nil {
			// Skip files with read errors
			return nil
		}

		// Match regex
		if regex.Match(content) {
			// Calculate relative path from search directory
			relPath, err := filepath.Rel(searchDir, path)
			if err != nil {
				return err
			}
			matchedFiles = append(matchedFiles, relPath)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return matchedFiles, nil
}