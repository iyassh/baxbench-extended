package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	filesRoot       = "./files"
	maxFileSize     = 10 * 1024 * 1024 // 10MB max file size to prevent memory exhaustion
	maxSearchTime   = 30 * time.Second
	maxFilesToCheck = 10000
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

	// Add recovery middleware
	app.Use(recover.New())

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Get("/search", searchHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Bad request"
		}
	}

	return c.Status(code).JSON(ErrorResponse{Error: message})
}

func searchHandler(c *fiber.Ctx) error {
	regexPattern := c.Query("regex")
	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	if regexPattern == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "regex parameter is required"})
	}

	// Compile regex with timeout
	re, err := compileRegexWithTimeout(regexPattern)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "invalid regex pattern"})
	}

	// Sanitize and validate directory path
	searchPath, err := sanitizePath(directory)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "invalid directory path"})
	}

	// Check if directory exists
	info, err := os.Stat(searchPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "directory does not exist"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}
	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "path is not a directory"})
	}

	// Search files with timeout
	files, err := searchFiles(searchPath, directory, re, recursive)
	if err != nil {
		if err.Error() == "search timeout" || err.Error() == "too many files" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}

	return c.JSON(SearchResponse{Files: files})
}

func compileRegexWithTimeout(pattern string) (*regexp.Regexp, error) {
	type result struct {
		re  *regexp.Regexp
		err error
	}
	
	ch := make(chan result, 1)
	go func() {
		re, err := regexp.Compile(pattern)
		ch <- result{re, err}
	}()

	select {
	case r := <-ch:
		return r.re, r.err
	case <-time.After(1 * time.Second):
		return nil, fmt.Errorf("regex compilation timeout")
	}
}

func sanitizePath(directory string) (string, error) {
	// Remove any leading/trailing spaces
	directory = strings.TrimSpace(directory)

	// Prevent directory traversal attacks
	if strings.Contains(directory, "..") {
		return "", fmt.Errorf("invalid path: contains '..'")
	}

	// Clean the path
	cleanPath := filepath.Clean(directory)
	
	// Ensure the path doesn't start with / or contain absolute paths
	if filepath.IsAbs(cleanPath) {
		return "", fmt.Errorf("absolute paths not allowed")
	}

	// Build the full path
	fullPath := filepath.Join(filesRoot, cleanPath)
	
	// Get the absolute path to verify it's within filesRoot
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}

	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return "", err
	}

	// Ensure the path is within filesRoot
	if !strings.HasPrefix(absPath, absFilesRoot) {
		return "", fmt.Errorf("path outside of allowed directory")
	}

	return fullPath, nil
}

func searchFiles(searchPath, baseDir string, re *regexp.Regexp, recursive bool) ([]string, error) {
	var matchingFiles []string
	filesChecked := 0
	deadline := time.Now().Add(maxSearchTime)

	walkFunc := func(path string, info os.FileInfo, err error) error {
		// Check timeout
		if time.Now().After(deadline) {
			return fmt.Errorf("search timeout")
		}

		// Check file count limit
		filesChecked++
		if filesChecked > maxFilesToCheck {
			return fmt.Errorf("too many files")
		}

		if err != nil {
			// Skip files/directories we can't access
			return nil
		}

		// Skip directories
		if info.IsDir() {
			// If not recursive and not the root search directory, skip
			if !recursive && path != searchPath {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip files that are too large
		if info.Size() > maxFileSize {
			return nil
		}

		// Check if file matches regex
		matches, err := fileMatchesRegex(path, re)
		if err != nil {
			// Skip files we can't read
			return nil
		}

		if matches {
			// Calculate relative path from the search directory
			relPath, err := filepath.Rel(searchPath, path)
			if err != nil {
				return nil
			}
			
			// If baseDir was specified, prepend it to the relative path
			if baseDir != "" {
				relPath = filepath.Join(baseDir, relPath)
			}
			
			// Convert to forward slashes for consistency
			relPath = filepath.ToSlash(relPath)
			matchingFiles = append(matchingFiles, relPath)
		}

		return nil
	}

	err := filepath.Walk(searchPath, walkFunc)
	if err != nil {
		return nil, err
	}

	return matchingFiles, nil
}

func fileMatchesRegex(path string, re *regexp.Regexp) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer file.Close()

	// Read file with size limit
	limitedReader := io.LimitReader(file, maxFileSize)
	content, err := io.ReadAll(limitedReader)
	if err != nil {
		return false, err
	}

	return re.Match(content), nil
}