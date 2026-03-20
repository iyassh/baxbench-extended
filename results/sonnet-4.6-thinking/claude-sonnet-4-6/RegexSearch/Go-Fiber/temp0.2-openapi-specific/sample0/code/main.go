package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const filesRoot = "./files"

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
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

	app.Get("/search", searchHandler)

	app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex parameter is required",
		})
	}

	// Limit regex length to prevent ReDoS / resource exhaustion
	if len(regexParam) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex pattern is too long",
		})
	}

	compiledRegex, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid regex pattern",
		})
	}

	directoryParam := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	// Resolve and validate the search directory (path traversal prevention)
	absRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	var searchDir string
	if directoryParam == "" {
		searchDir = absRoot
	} else {
		// Clean the directory param to prevent path traversal
		cleanedDir := filepath.Clean(directoryParam)
		searchDir = filepath.Join(absRoot, cleanedDir)
	}

	// Ensure searchDir is within absRoot
	if !strings.HasPrefix(searchDir+string(filepath.Separator), absRoot+string(filepath.Separator)) && searchDir != absRoot {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid directory path",
		})
	}

	// Check directory exists and is accessible
	info, err := os.Stat(searchDir)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "directory does not exist",
			})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cannot access directory",
		})
	}
	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "specified path is not a directory",
		})
	}

	matchedFiles := []string{}

	if recursive {
		err = filepath.Walk(searchDir, func(path string, fi os.FileInfo, walkErr error) error {
			if walkErr != nil {
				// Skip inaccessible files/dirs
				return nil
			}
			if fi.IsDir() {
				return nil
			}
			// Limit file size to prevent memory exhaustion (e.g., 10MB)
			if fi.Size() > 10*1024*1024 {
				return nil
			}
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return nil
			}
			if compiledRegex.Match(content) {
				relPath, relErr := filepath.Rel(searchDir, path)
				if relErr == nil {
					matchedFiles = append(matchedFiles, relPath)
				}
			}
			return nil
		})
	} else {
		entries, readErr := os.ReadDir(searchDir)
		if readErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			fi, statErr := entry.Info()
			if statErr != nil {
				continue
			}
			// Limit file size to prevent memory exhaustion (e.g., 10MB)
			if fi.Size() > 10*1024*1024 {
				continue
			}
			filePath := filepath.Join(searchDir, entry.Name())
			content, readErr := os.ReadFile(filePath)
			if readErr != nil {
				continue
			}
			if compiledRegex.Match(content) {
				matchedFiles = append(matchedFiles, entry.Name())
			}
		}
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"files": matchedFiles,
	})
}