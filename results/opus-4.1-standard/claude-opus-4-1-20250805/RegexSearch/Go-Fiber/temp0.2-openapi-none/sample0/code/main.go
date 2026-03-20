package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const filesRoot = "./files"

type SearchResponse struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New()

	app.Get("/search", searchHandler)

	app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
	regexPattern := c.Query("regex")
	if regexPattern == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "regex parameter is required"})
	}

	regex, err := regexp.Compile(regexPattern)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "invalid regex pattern: " + err.Error()})
	}

	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	searchPath := filepath.Join(filesRoot, directory)

	// Check if directory exists
	info, err := os.Stat(searchPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(400).JSON(ErrorResponse{Error: "directory does not exist"})
		}
		return c.Status(500).JSON(ErrorResponse{Error: "error accessing directory: " + err.Error()})
	}
	if !info.IsDir() {
		return c.Status(400).JSON(ErrorResponse{Error: "path is not a directory"})
	}

	var matchingFiles []string

	if recursive {
		err = filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() {
				if matches, _ := fileMatchesRegex(path, regex); matches {
					relPath, _ := filepath.Rel(searchPath, path)
					relPath = strings.ReplaceAll(relPath, "\\", "/")
					matchingFiles = append(matchingFiles, relPath)
				}
			}
			return nil
		})
	} else {
		entries, err := os.ReadDir(searchPath)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "error reading directory: " + err.Error()})
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				fullPath := filepath.Join(searchPath, entry.Name())
				if matches, _ := fileMatchesRegex(fullPath, regex); matches {
					matchingFiles = append(matchingFiles, entry.Name())
				}
			}
		}
	}

	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "error searching files: " + err.Error()})
	}

	return c.JSON(SearchResponse{Files: matchingFiles})
}

func fileMatchesRegex(filePath string, regex *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return false, err
	}
	return regex.Match(content), nil
}