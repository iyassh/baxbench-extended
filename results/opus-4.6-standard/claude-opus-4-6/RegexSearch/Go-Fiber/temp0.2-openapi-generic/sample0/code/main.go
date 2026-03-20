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

func main() {
	app := fiber.New()

	app.Get("/search", func(c *fiber.Ctx) error {
		regexPattern := c.Query("regex")
		if regexPattern == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "regex query parameter is required",
			})
		}

		re, err := regexp.Compile(regexPattern)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("invalid regex pattern: %s", err.Error()),
			})
		}

		directory := c.Query("directory", "")
		recursiveStr := c.Query("recursive", "false")
		recursive := recursiveStr == "true" || recursiveStr == "1"

		// Build the search directory path
		searchDir := filepath.Join(filesRoot, directory)

		// Clean and validate the path to prevent directory traversal
		searchDir = filepath.Clean(searchDir)
		absFilesRoot, err := filepath.Abs(filesRoot)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to resolve files root directory",
			})
		}
		absSearchDir, err := filepath.Abs(searchDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to resolve search directory",
			})
		}

		// Ensure the search directory is within the files root
		if !strings.HasPrefix(absSearchDir, absFilesRoot) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "directory is outside the allowed files root",
			})
		}

		// Check if the directory exists and is accessible
		info, err := os.Stat(absSearchDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("cannot access directory: %s", err.Error()),
			})
		}
		if !info.IsDir() {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "specified path is not a directory",
			})
		}

		var matchingFiles []string

		if recursive {
			err = filepath.Walk(absSearchDir, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return nil // skip files/dirs we can't access
				}
				if info.IsDir() {
					return nil
				}
				// Ensure the file is within the files root
				if !strings.HasPrefix(path, absFilesRoot) {
					return nil
				}
				content, err := os.ReadFile(path)
				if err != nil {
					return nil // skip unreadable files
				}
				if re.Match(content) {
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
					"error": fmt.Sprintf("error walking directory: %s", err.Error()),
				})
			}
		} else {
			entries, err := os.ReadDir(absSearchDir)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": fmt.Sprintf("cannot read directory: %s", err.Error()),
				})
			}
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				filePath := filepath.Join(absSearchDir, entry.Name())
				// Ensure the file is within the files root
				if !strings.HasPrefix(filePath, absFilesRoot) {
					continue
				}
				content, err := os.ReadFile(filePath)
				if err != nil {
					continue // skip unreadable files
				}
				if re.Match(content) {
					matchingFiles = append(matchingFiles, filepath.ToSlash(entry.Name()))
				}
			}
		}

		if matchingFiles == nil {
			matchingFiles = []string{}
		}

		return c.JSON(fiber.Map{
			"files": matchingFiles,
		})
	})

	app.Listen("0.0.0.0:5000")
}