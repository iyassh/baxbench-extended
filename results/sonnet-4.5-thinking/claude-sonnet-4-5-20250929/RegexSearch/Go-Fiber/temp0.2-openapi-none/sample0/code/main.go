package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Get("/search", searchHandler)

	app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
	regexPattern := c.Query("regex")
	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	if regexPattern == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "regex parameter is required",
		})
	}

	re, err := regexp.Compile(regexPattern)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "invalid regex pattern: " + err.Error(),
		})
	}

	filesRoot := "./files"
	searchDir := filepath.Join(filesRoot, directory)

	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "failed to resolve files root: " + err.Error(),
		})
	}

	absSearchDir, err := filepath.Abs(searchDir)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "failed to resolve search directory: " + err.Error(),
		})
	}

	relToRoot, err := filepath.Rel(absFilesRoot, absSearchDir)
	if err != nil || strings.HasPrefix(relToRoot, "..") {
		return c.Status(400).JSON(fiber.Map{
			"error": "directory must be within files root",
		})
	}

	info, err := os.Stat(searchDir)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "directory not accessible: " + err.Error(),
		})
	}
	if !info.IsDir() {
		return c.Status(400).JSON(fiber.Map{
			"error": "specified path is not a directory",
		})
	}

	matchingFiles := []string{}

	if recursive {
		err = filepath.WalkDir(searchDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() {
				matches, err := checkFileContent(path, re)
				if err != nil {
					return err
				}
				if matches {
					relPath, err := filepath.Rel(searchDir, path)
					if err != nil {
						return err
					}
					matchingFiles = append(matchingFiles, filepath.ToSlash(relPath))
				}
			}
			return nil
		})
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "search failed: " + err.Error(),
			})
		}
	} else {
		entries, err := os.ReadDir(searchDir)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "failed to read directory: " + err.Error(),
			})
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				path := filepath.Join(searchDir, entry.Name())
				matches, err := checkFileContent(path, re)
				if err != nil {
					return c.Status(500).JSON(fiber.Map{
						"error": "failed to read file: " + err.Error(),
					})
				}
				if matches {
					matchingFiles = append(matchingFiles, entry.Name())
				}
			}
		}
	}

	return c.JSON(fiber.Map{
		"files": matchingFiles,
	})
}

func checkFileContent(path string, re *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	return re.Match(content), nil
}