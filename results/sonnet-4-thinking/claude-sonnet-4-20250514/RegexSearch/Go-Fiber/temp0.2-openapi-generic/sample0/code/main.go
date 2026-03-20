package main

import (
	"fmt"
	"io"
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

	app.Get("/search", searchHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func searchHandler(c *fiber.Ctx) error {
	// Get query parameters
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(400).JSON(ErrorResponse{
			Error: "regex parameter is required",
		})
	}

	directory := c.Query("directory", "")
	recursiveParam := c.Query("recursive", "false")

	// Parse recursive parameter
	recursive, err := strconv.ParseBool(recursiveParam)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Error: "invalid recursive parameter, must be true or false",
		})
	}

	// Validate regex
	compiledRegex, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Error: fmt.Sprintf("invalid regex pattern: %s", err.Error()),
		})
	}

	// Build search directory path
	filesRoot := "./files"
	searchDir := filepath.Join(filesRoot, directory)

	// Validate directory is within files root (prevent directory traversal)
	searchDirAbs, err := filepath.Abs(searchDir)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Error: "invalid directory path",
		})
	}

	filesRootAbs, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "internal server error",
		})
	}

	relPath, err := filepath.Rel(filesRootAbs, searchDirAbs)
	if err != nil || strings.HasPrefix(relPath, "..") || filepath.IsAbs(relPath) {
		return c.Status(400).JSON(ErrorResponse{
			Error: "directory path is outside allowed root",
		})
	}

	// Check if directory exists
	if _, err := os.Stat(searchDir); os.IsNotExist(err) {
		return c.Status(400).JSON(ErrorResponse{
			Error: "directory does not exist",
		})
	}

	// Search for matching files
	matchingFiles, err := searchFiles(searchDir, compiledRegex, recursive)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: fmt.Sprintf("error searching files: %s", err.Error()),
		})
	}

	// Convert absolute paths to relative paths from search directory
	relativeFiles := make([]string, 0, len(matchingFiles))
	for _, file := range matchingFiles {
		relPath, err := filepath.Rel(searchDir, file)
		if err != nil {
			continue
		}
		relativeFiles = append(relativeFiles, relPath)
	}

	return c.JSON(SearchResponse{
		Files: relativeFiles,
	})
}

func searchFiles(dir string, regex *regexp.Regexp, recursive bool) ([]string, error) {
	var matchingFiles []string

	if recursive {
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}

			if !info.IsDir() {
				matches, err := fileMatches(path, regex)
				if err != nil {
					// Skip files that can't be read
					return nil
				}
				if matches {
					matchingFiles = append(matchingFiles, path)
				}
			}
			return nil
		})
		return matchingFiles, err
	} else {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				filePath := filepath.Join(dir, entry.Name())
				matches, err := fileMatches(filePath, regex)
				if err != nil {
					// Skip files that can't be read
					continue
				}
				if matches {
					matchingFiles = append(matchingFiles, filePath)
				}
			}
		}
	}

	return matchingFiles, nil
}

func fileMatches(filePath string, regex *regexp.Regexp) (bool, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return false, err
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return false, err
	}

	return regex.Match(content), nil
}