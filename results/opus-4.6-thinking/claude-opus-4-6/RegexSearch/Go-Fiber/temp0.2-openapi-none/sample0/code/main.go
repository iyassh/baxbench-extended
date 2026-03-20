package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Get("/search", func(c *fiber.Ctx) error {
		regexPattern := c.Query("regex")
		if regexPattern == "" {
			return c.Status(400).JSON(fiber.Map{
				"error": "regex query parameter is required",
			})
		}

		re, err := regexp.Compile(regexPattern)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": fmt.Sprintf("invalid regex pattern: %s", err.Error()),
			})
		}

		directory := c.Query("directory", "")
		recursiveStr := c.Query("recursive", "false")
		recursive := recursiveStr == "true"

		filesRoot := "./files"
		searchDir := filepath.Join(filesRoot, directory)

		// Clean the path to prevent directory traversal
		searchDir = filepath.Clean(searchDir)

		// Check if directory exists and is accessible
		info, err := os.Stat(searchDir)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": fmt.Sprintf("inaccessible directory: %s", err.Error()),
			})
		}
		if !info.IsDir() {
			return c.Status(400).JSON(fiber.Map{
				"error": "specified path is not a directory",
			})
		}

		var matchingFiles []string

		if recursive {
			err = filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if info.IsDir() {
					return nil
				}

				content, err := os.ReadFile(path)
				if err != nil {
					return nil // skip files we can't read
				}

				if re.Match(content) {
					relPath, err := filepath.Rel(searchDir, path)
					if err != nil {
						return nil
					}
					matchingFiles = append(matchingFiles, filepath.ToSlash(relPath))
				}
				return nil
			})
			if err != nil {
				return c.Status(500).JSON(fiber.Map{
					"error": fmt.Sprintf("error walking directory: %s", err.Error()),
				})
			}
		} else {
			entries, err := os.ReadDir(searchDir)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{
					"error": fmt.Sprintf("error reading directory: %s", err.Error()),
				})
			}

			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}

				filePath := filepath.Join(searchDir, entry.Name())
				content, err := os.ReadFile(filePath)
				if err != nil {
					continue // skip files we can't read
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