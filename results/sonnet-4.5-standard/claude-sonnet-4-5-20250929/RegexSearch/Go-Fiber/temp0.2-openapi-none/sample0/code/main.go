<CODE>
package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Get("/search", searchHandler)

	app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "regex parameter is required",
		})
	}

	re, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "invalid regex pattern: " + err.Error(),
		})
	}

	directory := c.Query("directory", "")
	recursiveParam := c.Query("recursive", "false")
	recursive, err := strconv.ParseBool(recursiveParam)
	if err != nil {
		recursive = false
	}

	filesRoot := "./files"
	searchPath := filepath.Join(filesRoot, directory)

	if _, err := os.Stat(searchPath); os.IsNotExist(err) {
		return c.Status(400).JSON(fiber.Map{
			"error": "directory does not exist",
		})
	}

	matchingFiles := []string{}

	if recursive {
		err = filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() {
				if matches, err := fileMatchesRegex(path, re); err == nil && matches {
					relPath, _ := filepath.Rel(searchPath, path)
					matchingFiles = append(matchingFiles, relPath)
				}
			}
			return nil
		})
	} else {
		entries, err := os.ReadDir(searchPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "failed to read directory: " + err.Error(),
			})
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				filePath := filepath.Join(searchPath, entry.Name())
				if matches, err := fileMatchesRegex(filePath, re); err == nil && matches {
					matchingFiles = append(matchingFiles, entry.Name())
				}
			}
		}
	}

	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "error searching files: " + err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"files": matchingFiles,
	})
}

func fileMatchesRegex(filePath string, re *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return false, err
	}

	return re.Match(content), nil
}
</CODE>