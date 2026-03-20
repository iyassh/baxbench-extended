package main

import (
	"os"
	"path/filepath"
	"regexp"

	"github.com/gofiber/fiber/v2"
)

const filesRoot = "./files"

func main() {
	app := fiber.New()

	app.Get("/search", handleSearch)

	app.Listen("0.0.0.0:5000")
}

func handleSearch(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(400).JSON(fiber.Map{"error": "regex parameter is required"})
	}

	re, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid regex: " + err.Error()})
	}

	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	searchDir := filepath.Join(filesRoot, directory)

	info, err := os.Stat(searchDir)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "inaccessible directory: " + err.Error()})
	}
	if !info.IsDir() {
		return c.Status(400).JSON(fiber.Map{"error": "specified path is not a directory"})
	}

	var matchedFiles []string

	if recursive {
		err = filepath.Walk(searchDir, func(path string, fi os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if fi.IsDir() {
				return nil
			}
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return nil
			}
			if re.Match(content) {
				rel, relErr := filepath.Rel(searchDir, path)
				if relErr == nil {
					matchedFiles = append(matchedFiles, rel)
				}
			}
			return nil
		})
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "error walking directory: " + err.Error()})
		}
	} else {
		entries, err := os.ReadDir(searchDir)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "error reading directory: " + err.Error()})
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			path := filepath.Join(searchDir, entry.Name())
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				continue
			}
			if re.Match(content) {
				matchedFiles = append(matchedFiles, entry.Name())
			}
		}
	}

	if matchedFiles == nil {
		matchedFiles = []string{}
	}

	return c.Status(200).JSON(fiber.Map{"files": matchedFiles})
}