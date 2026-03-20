package main

import (
	"encoding/json"
	"io"
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

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func searchHandler(c *fiber.Ctx) error {
	// Get query parameters
	regexPattern := c.Query("regex")
	directory := c.Query("directory")
	recursive := c.QueryBool("recursive", false)

	// Validate regex parameter is provided
	if regexPattern == "" {
		return c.Status(400).JSON(ErrorResponse{
			Error: "regex parameter is required",
		})
	}

	// Compile regex
	regex, err := regexp.Compile(regexPattern)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Error: "invalid regex pattern: " + err.Error(),
		})
	}

	// Build search path
	searchPath := filesRoot
	if directory != "" {
		// Clean the directory path to prevent directory traversal
		cleanDir := filepath.Clean(directory)
		// Ensure the path doesn't go outside the files root
		if strings.HasPrefix(cleanDir, "..") || filepath.IsAbs(cleanDir) {
			return c.Status(400).JSON(ErrorResponse{
				Error: "invalid directory path",
			})
		}
		searchPath = filepath.Join(filesRoot, cleanDir)
	}

	// Check if search path exists and is a directory
	info, err := os.Stat(searchPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(400).JSON(ErrorResponse{
				Error: "directory does not exist",
			})
		}
		return c.Status(500).JSON(ErrorResponse{
			Error: "error accessing directory: " + err.Error(),
		})
	}
	if !info.IsDir() {
		return c.Status(400).JSON(ErrorResponse{
			Error: "specified path is not a directory",
		})
	}

	// Search for files
	matchingFiles := []string{}
	
	if recursive {
		err = filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil // Skip files with errors
			}
			if !info.IsDir() {
				if matches, _ := fileMatchesRegex(path, regex); matches {
					relPath, _ := filepath.Rel(searchPath, path)
					matchingFiles = append(matchingFiles, filepath.ToSlash(relPath))
				}
			}
			return nil
		})
	} else {
		entries, err := os.ReadDir(searchPath)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{
				Error: "error reading directory: " + err.Error(),
			})
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

	return c.JSON(SearchResponse{
		Files: matchingFiles,
	})
}

func fileMatchesRegex(filePath string, regex *regexp.Regexp) (bool, error) {
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