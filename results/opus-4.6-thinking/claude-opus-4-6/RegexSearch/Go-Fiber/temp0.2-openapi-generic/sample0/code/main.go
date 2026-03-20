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

		// Resolve to absolute path and ensure it's within filesRoot
		absFilesRoot, err := filepath.Abs(filesRoot)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to resolve files root directory",
			})
		}

		absSearchDir, err := filepath.Abs(searchDir)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "failed to resolve search directory",
			})
		}

		// Security check: ensure search directory is within files root
		if !strings.HasPrefix(absSearchDir, absFilesRoot) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "directory path is outside the allowed files root",
			})
		}

		// Check if directory exists and is accessible
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
				// Security: ensure path is within files root
				if !strings.HasPrefix(path, absFilesRoot) {
					return nil
				}
				matched, err := matchFile(path, re)
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
					"error": fmt.Sprintf("error walking directory: %s", err.Error()),
				})
			}
		} else {
			entries, err := os.ReadDir(absSearchDir)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": fmt.Sprintf("error reading directory: %s", err.Error()),
				})
			}
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				fullPath := filepath.Join(absSearchDir, entry.Name())
				// Security: ensure path is within files root
				if !strings.HasPrefix(fullPath, absFilesRoot) {
					continue
				}
				matched, err := matchFile(fullPath, re)
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

		return c.JSON(fiber.Map{
			"files": matchingFiles,
		})
	})

	app.Listen("0.0.0.0:5000")
}

func matchFile(path string, re *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	return re.Match(content), nil
}