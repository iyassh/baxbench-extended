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
const maxRegexLen = 1000
const maxFileSize = 10 * 1024 * 1024 // 10MB

func main() {
	app := fiber.New(fiber.Config{
		// Disable detailed error messages in responses
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
		BodyLimit: 1 * 1024 * 1024,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
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

	directoryParam := c.Query("directory", "")
	recursiveParam := c.QueryBool("recursive", false)

	// Resolve the files root to an absolute path
	absRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Build the search directory
	searchDir := absRoot
	if directoryParam != "" {
		// Clean the path to prevent traversal
		cleaned := filepath.Clean(directoryParam)
		searchDir = filepath.Join(absRoot, cleaned)
	}

	// Resolve to absolute and ensure it's within the root
	absSearchDir, err := filepath.Abs(searchDir)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid directory path",
		})
	}

	// Ensure the search directory is within or equal to the files root
	if !isSubPath(absRoot, absSearchDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Directory path is outside the allowed root",
		})
	}

	// Check that the directory exists and is a directory
	info, err := os.Stat(absSearchDir)
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

	if recursiveParam {
		err = filepath.Walk(absSearchDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				// Skip files/dirs we can't access
				return nil
			}
			if info.IsDir() {
				return nil
			}
			// Ensure the resolved path is still within root (protect against symlinks)
			realPath, err := filepath.EvalSymlinks(path)
			if err != nil {
				return nil
			}
			if !isSubPath(absRoot, realPath) {
				return nil
			}
			if info.Size() > maxFileSize {
				return nil
			}
			matched, err := fileMatchesRegex(path, re)
			if err != nil {
				return nil
			}
			if matched {
				relPath, err := filepath.Rel(absSearchDir, path)
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
		entries, err := os.ReadDir(absSearchDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Unable to read directory",
			})
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			fullPath := filepath.Join(absSearchDir, entry.Name())

			// Protect against symlinks
			realPath, err := filepath.EvalSymlinks(fullPath)
			if err != nil {
				continue
			}
			if !isSubPath(absRoot, realPath) {
				continue
			}

			info, err := entry.Info()
			if err != nil {
				continue
			}
			if info.Size() > maxFileSize {
				continue
			}

			matched, err := fileMatchesRegex(fullPath, re)
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

// isSubPath checks if child is equal to or a subdirectory of parent.
func isSubPath(parent, child string) bool {
	// Ensure both paths end consistently
	parentClean := filepath.Clean(parent) + string(filepath.Separator)
	childClean := filepath.Clean(child)

	// child is exactly parent
	if childClean == filepath.Clean(parent) {
		return true
	}

	return strings.HasPrefix(childClean+string(filepath.Separator), parentClean)
}