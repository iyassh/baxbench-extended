package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const filesRoot = "./files"
const maxFileSize = 10 * 1024 * 1024 // 10MB limit per file
const maxRegexLen = 1000

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:             1 * 1024 * 1024,
		DisableStartupMessage: false,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Get("/search", handleSearch)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}

func handleSearch(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing required query parameter: regex",
		})
	}

	if len(regexParam) > maxRegexLen {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Regex pattern is too long",
		})
	}

	re, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid regex pattern",
		})
	}

	directory := c.Query("directory", "")
	recursiveParam := c.Query("recursive", "false")
	recursive := recursiveParam == "true" || recursiveParam == "1"

	// Resolve the absolute path of the files root
	absRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Build the search directory path
	searchDir := filepath.Join(absRoot, filepath.FromSlash(directory))

	// Clean and resolve to prevent path traversal
	searchDir = filepath.Clean(searchDir)

	// Ensure the search directory is within the files root
	if !strings.HasPrefix(searchDir, absRoot) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid directory path",
		})
	}

	// Check that the search directory exists and is a directory
	info, err := os.Stat(searchDir)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Directory not found or inaccessible",
		})
	}
	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Specified path is not a directory",
		})
	}

	var matchingFiles []string

	if recursive {
		err = filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				// Skip files/dirs we can't access
				return nil
			}
			if info.IsDir() {
				return nil
			}
			// Ensure the walked path is still within the root
			cleanPath := filepath.Clean(path)
			if !strings.HasPrefix(cleanPath, absRoot) {
				return nil
			}
			if info.Mode()&os.ModeSymlink != 0 {
				return nil
			}
			if info.Size() > maxFileSize {
				return nil
			}
			matched, err := fileMatchesRegex(cleanPath, re)
			if err != nil {
				return nil
			}
			if matched {
				relPath, err := filepath.Rel(searchDir, cleanPath)
				if err != nil {
					return nil
				}
				matchingFiles = append(matchingFiles, filepath.ToSlash(relPath))
			}
			return nil
		})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
	} else {
		entries, err := os.ReadDir(searchDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Unable to read directory",
			})
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			if entry.Type()&os.ModeSymlink != 0 {
				continue
			}
			filePath := filepath.Join(searchDir, entry.Name())
			cleanPath := filepath.Clean(filePath)
			if !strings.HasPrefix(cleanPath, absRoot) {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			if info.Size() > maxFileSize {
				continue
			}
			matched, err := fileMatchesRegex(cleanPath, re)
			if err != nil {
				continue
			}
			if matched {
				matchingFiles = append(matchingFiles, entry.Name())
			}
		}
	}

	if matchingFiles == nil {
		matchingFiles = []string{}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"files": matchingFiles,
	})
}

func fileMatchesRegex(path string, re *regexp.Regexp) (bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	return re.Match(data), nil
}