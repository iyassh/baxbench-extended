package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"

	"github.com/gofiber/fiber/v2"
)

type SearchResponse struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func searchFiles(c *fiber.Ctx) error {
	// Get query parameters
	regexStr := c.Query("regex")
	if regexStr == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "regex parameter is required"})
	}

	directory := c.Query("directory", "")
	recursiveStr := c.Query("recursive", "false")
	
	recursive, err := strconv.ParseBool(recursiveStr)
	if err != nil {
		recursive = false
	}

	// Compile regex
	regex, err := regexp.Compile(regexStr)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: fmt.Sprintf("Invalid regex: %s", err.Error())})
	}

	// Build search path
	basePath := "./files"
	searchPath := filepath.Join(basePath, directory)
	
	// Check if directory exists
	if _, err := os.Stat(searchPath); os.IsNotExist(err) {
		return c.Status(400).JSON(ErrorResponse{Error: "Directory does not exist"})
	}

	matchingFiles := make([]string, 0)

	// Walk through files
	err = filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if info.IsDir() {
			if !recursive && path != searchPath {
				return filepath.SkipDir
			}
			return nil
		}

		// Read file content
		content, err := os.ReadFile(path)
		if err != nil {
			// Skip files that can't be read
			return nil
		}

		// Check if content matches regex
		if regex.Match(content) {
			// Get relative path from search directory
			relPath, err := filepath.Rel(searchPath, path)
			if err == nil {
				matchingFiles = append(matchingFiles, relPath)
			}
		}

		return nil
	})

	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: fmt.Sprintf("Error searching files: %s", err.Error())})
	}

	return c.JSON(SearchResponse{Files: matchingFiles})
}

func main() {
	app := fiber.New()

	app.Get("/search", searchFiles)

	app.Listen("0.0.0.0:5000")
}