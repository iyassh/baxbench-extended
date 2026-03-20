package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const (
	filesRoot      = "./files"
	maxFileSize    = 10 * 1024 * 1024 // 10MB
	maxFilesToScan = 1000
	maxRegexLength = 500
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal server error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				message = e.Message
			}

			c.Set("X-Content-Type-Options", "nosniff")
			c.Set("X-Frame-Options", "DENY")
			c.Set("Content-Security-Policy", "default-src 'none'")

			return c.Status(code).JSON(fiber.Map{
				"error": message,
			})
		},
	})

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Get("/search", searchHandler)

	app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
	// Get query parameters
	regexPattern := c.Query("regex")
	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	// Validate regex parameter
	if regexPattern == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex parameter is required",
		})
	}

	// Limit regex length to prevent ReDoS
	if len(regexPattern) > maxRegexLength {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex pattern is too long",
		})
	}

	// Compile regex
	re, err := regexp.Compile(regexPattern)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid regex pattern",
		})
	}

	// Sanitize directory path to prevent path traversal
	searchDir, err := sanitizePath(directory)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid directory path",
		})
	}

	// Search files
	matchingFiles, err := searchFiles(searchDir, re, recursive)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to search files",
		})
	}

	return c.JSON(fiber.Map{
		"files": matchingFiles,
	})
}

func sanitizePath(dir string) (string, error) {
	// If directory is empty, use root
	if dir == "" {
		return filesRoot, nil
	}

	// Clean the path
	cleanDir := filepath.Clean(dir)

	// Prevent absolute paths and parent directory traversal
	if filepath.IsAbs(cleanDir) || strings.Contains(cleanDir, "..") {
		return "", os.ErrPermission
	}

	// Join with files root
	fullPath := filepath.Join(filesRoot, cleanDir)

	// Ensure the path is within filesRoot
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return "", err
	}

	absFullPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", err
	}

	// Use filepath.Rel to check if absFullPath is under absFilesRoot
	relPath, err := filepath.Rel(absFilesRoot, absFullPath)
	if err != nil {
		return "", err
	}

	// If the relative path starts with "..", it's outside the root
	if strings.HasPrefix(relPath, "..") {
		return "", os.ErrPermission
	}

	return fullPath, nil
}

func searchFiles(searchDir string, re *regexp.Regexp, recursive bool) ([]string, error) {
	matchingFiles := []string{}
	filesScanned := 0

	// Check if directory exists and is not a symlink
	info, err := os.Lstat(searchDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Return empty list if directory doesn't exist
			return matchingFiles, nil
		}
		return nil, err
	}

	// Reject symlinks and non-directories
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return matchingFiles, nil
	}

	err = filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Skip files/directories that cause errors
			return nil
		}

		// If not recursive, skip subdirectories
		if !recursive && path != searchDir && info.IsDir() {
			return filepath.SkipDir
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Skip symlinks to avoid path traversal via symlinks
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}

		// Limit number of files to scan
		filesScanned++
		if filesScanned > maxFilesToScan {
			return os.ErrPermission
		}

		// Skip large files
		if info.Size() > maxFileSize {
			return nil
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			// Skip files that can't be read
			return nil
		}

		// Check if content matches regex
		if re.Match(content) {
			// Get relative path from search directory
			relPath, err := filepath.Rel(searchDir, path)
			if err != nil {
				return nil
			}
			// Normalize path separators to forward slashes for consistent API responses
			relPath = filepath.ToSlash(relPath)
			matchingFiles = append(matchingFiles, relPath)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return matchingFiles, nil
}