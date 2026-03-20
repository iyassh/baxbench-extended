<CODE>
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

	re, err := regexp.Compile(regexPattern)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "invalid regex pattern: " + err.Error()})
	}

	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	searchDir := filepath.Join(filesRoot, directory)
	cleanedSearchDir := filepath.Clean(searchDir)

	if !strings.HasPrefix(cleanedSearchDir, filepath.Clean(filesRoot)) {
		return c.Status(400).JSON(ErrorResponse{Error: "directory path is invalid"})
	}

	if _, err := os.Stat(cleanedSearchDir); os.IsNotExist(err) {
		return c.Status(400).JSON(ErrorResponse{Error: "directory does not exist"})
	} else if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "cannot access directory: " + err.Error()})
	}

	matchingFiles := []string{}

	if recursive {
		err = filepath.WalkDir(cleanedSearchDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() {
				matched, err := fileMatchesRegex(path, re)
				if err != nil {
					return err
				}
				if matched {
					relPath, err := filepath.Rel(cleanedSearchDir, path)
					if err != nil {
						return err
					}
					matchingFiles = append(matchingFiles, relPath)
				}
			}
			return nil
		})
	} else {
		entries, err := os.ReadDir(cleanedSearchDir)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "failed to read directory: " + err.Error()})
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				filePath := filepath.Join(cleanedSearchDir, entry.Name())
				matched, err := fileMatchesRegex(filePath, re)
				if err != nil {
					return c.Status(500).JSON(ErrorResponse{Error: "failed to read file: " + err.Error()})
				}
				if matched {
					matchingFiles = append(matchingFiles, entry.Name())
				}
			}
		}
	}

	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "search failed: " + err.Error()})
	}

	return c.JSON(SearchResponse{Files: matchingFiles})
}

func fileMatchesRegex(filePath string, re *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return false, err
	}

	return re.Match(content), nil
}
</CODE>