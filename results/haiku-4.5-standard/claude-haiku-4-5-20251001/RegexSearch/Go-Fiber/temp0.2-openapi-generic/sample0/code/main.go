package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Get("/search", handleSearch)

	app.Listen(":5000")
}

func handleSearch(c *fiber.Ctx) error {
	regexPattern := c.Query("regex")
	if regexPattern == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex parameter is required",
		})
	}

	// Validate regex pattern
	re, err := regexp.Compile(regexPattern)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("invalid regex pattern: %v", err),
		})
	}

	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	// Construct the search path
	filesRoot := "./files"
	searchPath := filepath.Join(filesRoot, directory)

	// Validate that searchPath is within filesRoot
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to resolve files root directory",
		})
	}

	absSearchPath, err := filepath.Abs(searchPath)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid directory path",
		})
	}

	if !strings.HasPrefix(absSearchPath, absFilesRoot) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "directory path must be within files root",
		})
	}

	// Check if directory exists
	info, err := os.Stat(absSearchPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "directory does not exist",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to access directory",
		})
	}

	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "specified path is not a directory",
		})
	}

	// Search for matching files
	matchingFiles := []string{}
	var searchErr error

	if recursive {
		searchErr = filepath.WalkDir(absSearchPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}

			if d.IsDir() {
				return nil
			}

			if matchesRegex(path, re) {
				relPath, err := filepath.Rel(absSearchPath, path)
				if err != nil {
					return err
				}
				matchingFiles = append(matchingFiles, filepath.ToSlash(relPath))
			}

			return nil
		})
	} else {
		entries, err := os.ReadDir(absSearchPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to read directory",
			})
		}

		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}

			filePath := filepath.Join(absSearchPath, entry.Name())
			if matchesRegex(filePath, re) {
				matchingFiles = append(matchingFiles, entry.Name())
			}
		}
	}

	if searchErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "error during file search",
		})
	}

	return c.JSON(fiber.Map{
		"files": matchingFiles,
	})
}

func matchesRegex(filePath string, re *regexp.Regexp) bool {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return false
	}

	return re.Match(content)
}