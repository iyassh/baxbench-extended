package main

import (
	"io/fs"
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
)

const (
	filesRoot   = "./files"
	maxFileSize = 10 * 1024 * 1024 // 10MB
	maxFiles    = 1000
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Add logger middleware
	app.Use(logger.New())

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	// Search endpoint
	app.Get("/search", searchHandler)

	app.Listen("0.0.0.0:5000")
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func searchHandler(c *fiber.Ctx) error {
	regexStr := c.Query("regex")
	directory := c.Query("directory")
	recursive := c.QueryBool("recursive", false)

	if regexStr == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex parameter is required",
		})
	}

	// Compile regex with size limit to prevent ReDoS
	if len(regexStr) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex pattern too long",
		})
	}

	re, err := regexp.Compile(regexStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid regex pattern",
		})
	}

	// Build search path
	searchPath := filesRoot
	if directory != "" {
		// Validate directory to prevent path traversal
		cleanDir := filepath.Clean(directory)
		if strings.Contains(cleanDir, "..") || filepath.IsAbs(cleanDir) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid directory path",
			})
		}
		searchPath = filepath.Join(filesRoot, cleanDir)
	}

	// Ensure search path is within files root
	absSearchPath, err := filepath.Abs(searchPath)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid directory path",
		})
	}
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}
	if !strings.HasPrefix(absSearchPath, absFilesRoot) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid directory path",
		})
	}

	// Check if search path exists
	info, err := os.Stat(searchPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "directory not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}
	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "path is not a directory",
		})
	}

	// Search files
	matchingFiles := []string{}
	filesProcessed := 0

	walkFunc := func(path string, info fs.FileInfo, err error) error {
		if err != nil {
			return nil // Skip files with errors
		}

		// Skip directories
		if info.IsDir() {
			// If not recursive and not the root search path, skip
			if !recursive && path != searchPath {
				return filepath.SkipDir
			}
			return nil
		}

		// Limit number of files processed
		filesProcessed++
		if filesProcessed > maxFiles {
			return filepath.SkipDir
		}

		// Skip files that are too large
		if info.Size() > maxFileSize {
			return nil
		}

		// Read file content
		content, err := ioutil.ReadFile(path)
		if err != nil {
			return nil // Skip files that can't be read
		}

		// Check if content matches regex
		if re.Match(content) {
			// Get relative path from search directory
			relPath, err := filepath.Rel(searchPath, path)
			if err != nil {
				return nil
			}
			// Additional safety check
			if !strings.Contains(relPath, "..") {
				matchingFiles = append(matchingFiles, relPath)
			}
		}

		return nil
	}

	err = filepath.Walk(searchPath, walkFunc)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "error searching files",
		})
	}

	return c.JSON(fiber.Map{
		"files": matchingFiles,
	})
}