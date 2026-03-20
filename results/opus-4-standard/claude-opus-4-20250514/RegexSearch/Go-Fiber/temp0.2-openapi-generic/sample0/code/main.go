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

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func searchHandler(c *fiber.Ctx) error {
	// Get query parameters
	regexPattern := c.Query("regex")
	directory := c.Query("directory")
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
	searchPath := filepath.Join(filesRoot, directory)
	
	// Clean the path to prevent directory traversal
	searchPath = filepath.Clean(searchPath)
	
	// Ensure the search path is within filesRoot
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "failed to resolve files root path",
		})
	}
	
	absSearchPath, err := filepath.Abs(searchPath)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Error: "invalid directory path",
		})
	}
	
	if !strings.HasPrefix(absSearchPath, absFilesRoot) {
		return c.Status(400).JSON(ErrorResponse{
			Error: "directory path is outside of allowed files root",
		})
	}

	// Check if directory exists
	info, err := os.Stat(searchPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(400).JSON(ErrorResponse{
				Error: "directory does not exist",
			})
		}
		return c.Status(500).JSON(ErrorResponse{
			Error: "failed to access directory: " + err.Error(),
		})
	}
	
	if !info.IsDir() {
		return c.Status(400).JSON(ErrorResponse{
			Error: "path is not a directory",
		})
	}

	// Search for files
	var matchingFiles []string
	
	if recursive {
		err = filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			
			if !d.IsDir() {
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
				Error: "failed to read directory: " + err.Error(),
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
	
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "error during file search: " + err.Error(),
		})
	}

	return c.JSON(SearchResponse{
		Files: matchingFiles,
	})
}

func fileMatchesRegex(filePath string, regex *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		// Skip files that can't be read
		return false, nil
	}
	
	return regex.Match(content), nil
}