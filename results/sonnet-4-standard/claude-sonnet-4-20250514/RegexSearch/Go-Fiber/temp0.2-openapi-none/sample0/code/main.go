package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type SearchResponse struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New()

	app.Get("/search", searchFiles)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func searchFiles(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "regex parameter is required"})
	}

	directory := c.Query("directory", "")
	recursiveParam := c.Query("recursive", "false")

	recursive, err := strconv.ParseBool(recursiveParam)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "invalid recursive parameter"})
	}

	compiledRegex, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "invalid regex pattern"})
	}

	filesRoot := "./files"
	searchPath := filepath.Join(filesRoot, directory)

	if _, err := os.Stat(searchPath); os.IsNotExist(err) {
		return c.Status(400).JSON(ErrorResponse{Error: "directory does not exist"})
	}

	var matchingFiles []string

	if recursive {
		err = filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}

			if !d.IsDir() {
				if matches, fileErr := fileMatches(path, compiledRegex); fileErr != nil {
					return fileErr
				} else if matches {
					relPath, relErr := filepath.Rel(searchPath, path)
					if relErr != nil {
						return relErr
					}
					matchingFiles = append(matchingFiles, relPath)
				}
			}
			return nil
		})
	} else {
		entries, err := os.ReadDir(searchPath)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "failed to read directory"})
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				filePath := filepath.Join(searchPath, entry.Name())
				if matches, fileErr := fileMatches(filePath, compiledRegex); fileErr != nil {
					return c.Status(500).JSON(ErrorResponse{Error: fmt.Sprintf("error reading file %s: %v", entry.Name(), fileErr)})
				} else if matches {
					matchingFiles = append(matchingFiles, entry.Name())
				}
			}
		}
	}

	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: fmt.Sprintf("error searching files: %v", err)})
	}

	return c.JSON(SearchResponse{Files: matchingFiles})
}

func fileMatches(filePath string, regex *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return false, err
	}

	return regex.Match(content), nil
}