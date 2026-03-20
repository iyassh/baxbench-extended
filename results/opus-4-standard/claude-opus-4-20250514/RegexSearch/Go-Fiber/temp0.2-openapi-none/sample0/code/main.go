package main

import (
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
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

	app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
	// Get query parameters
	regexPattern := c.Query("regex")
	directory := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	// Validate regex parameter
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
	searchPath := filepath.Join("./files", directory)

	// Check if directory exists
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
	var matchingFiles []string

	if recursive {
		err = filepath.Walk(searchPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}

			if !info.IsDir() {
				if matches, _ := fileMatchesRegex(path, regex); matches {
					relativePath, _ := filepath.Rel(searchPath, path)
					relativePath = strings.ReplaceAll(relativePath, "\\", "/")
					matchingFiles = append(matchingFiles, relativePath)
				}
			}

			return nil
		})
	} else {
		files, err := ioutil.ReadDir(searchPath)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{
				Error: "error reading directory: " + err.Error(),
			})
		}

		for _, file := range files {
			if !file.IsDir() {
				fullPath := filepath.Join(searchPath, file.Name())
				if matches, _ := fileMatchesRegex(fullPath, regex); matches {
					matchingFiles = append(matchingFiles, file.Name())
				}
			}
		}
	}

	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "error searching files: " + err.Error(),
		})
	}

	return c.JSON(SearchResponse{
		Files: matchingFiles,
	})
}

func fileMatchesRegex(filePath string, regex *regexp.Regexp) (bool, error) {
	content, err := ioutil.ReadFile(filePath)
	if err != nil {
		return false, err
	}

	return regex.Match(content), nil
}