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

	directory := c.Query("directory", "")
	recursiveStr := c.Query("recursive", "false")
	recursive := recursiveStr == "true"

	re, err := regexp.Compile(regexPattern)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("invalid regex pattern: %v", err),
		})
	}

	searchPath := filepath.Join("files", directory)

	fileInfo, err := os.Stat(searchPath)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("inaccessible directory: %v", err),
		})
	}

	if !fileInfo.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "specified path is not a directory",
		})
	}

	matchingFiles, err := searchFiles(searchPath, re, recursive, directory)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("internal server error: %v", err),
		})
	}

	return c.JSON(fiber.Map{
		"files": matchingFiles,
	})
}

func searchFiles(rootPath string, re *regexp.Regexp, recursive bool, baseDir string) ([]string, error) {
	var matchingFiles []string

	if recursive {
		err := filepath.WalkDir(rootPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}

			if d.IsDir() {
				return nil
			}

			if matches, err := fileMatches(path, re); err == nil && matches {
				relPath, _ := filepath.Rel(rootPath, path)
				if baseDir != "" {
					relPath = filepath.Join(baseDir, relPath)
				}
				matchingFiles = append(matchingFiles, filepath.ToSlash(relPath))
			}

			return nil
		})
		return matchingFiles, err
	}

	entries, err := os.ReadDir(rootPath)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filePath := filepath.Join(rootPath, entry.Name())
		if matches, err := fileMatches(filePath, re); err == nil && matches {
			if baseDir != "" {
				matchingFiles = append(matchingFiles, filepath.ToSlash(filepath.Join(baseDir, entry.Name())))
			} else {
				matchingFiles = append(matchingFiles, filepath.ToSlash(entry.Name()))
			}
		}
	}

	return matchingFiles, nil
}

func fileMatches(filePath string, re *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return false, err
	}

	return re.MatchString(string(content)), nil
}