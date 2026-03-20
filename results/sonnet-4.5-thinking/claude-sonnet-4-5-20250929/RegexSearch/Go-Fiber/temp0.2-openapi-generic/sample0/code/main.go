package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const (
	filesRoot   = "./files"
	maxFileSize = 10 * 1024 * 1024
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
	regexPattern := c.Query("regex")
	directory := c.Query("directory", "")
	recursiveStr := c.Query("recursive", "false")
	recursive := recursiveStr == "true"

	if regexPattern == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "regex parameter is required",
		})
	}

	re, err := regexp.Compile(regexPattern)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: fmt.Sprintf("invalid regex pattern: %v", err),
		})
	}

	searchDir, err := sanitizePath(filesRoot, directory)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: fmt.Sprintf("invalid directory: %v", err),
		})
	}

	info, err := os.Stat(searchDir)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "directory does not exist",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "failed to access directory",
		})
	}

	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "specified path is not a directory",
		})
	}

	matchingFiles, err := searchFiles(searchDir, re, recursive)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: fmt.Sprintf("error searching files: %v", err),
		})
	}

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

func sanitizePath(root, subPath string) (string, error) {
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	cleanRoot = filepath.Clean(cleanRoot)

	if subPath == "" {
		return cleanRoot, nil
	}

	fullPath := filepath.Join(cleanRoot, subPath)
	fullPath = filepath.Clean(fullPath)

	rel, err := filepath.Rel(cleanRoot, fullPath)
	if err != nil {
		return "", fmt.Errorf("path traversal detected")
	}
	if strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("path traversal detected")
	}

	return fullPath, nil
}

func searchFiles(dir string, re *regexp.Regexp, recursive bool) ([]string, error) {
	var matchingFiles []string

	if recursive {
		err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}

			if d.IsDir() {
				return nil
			}

			matches, err := fileMatchesRegex(path, re)
			if err != nil {
				return nil
			}

			if matches {
				matchingFiles = append(matchingFiles, path)
			}

			return nil
		})

		if err != nil {
			return nil, err
		}
	} else {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}

		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}

			path := filepath.Join(dir, entry.Name())
			matches, err := fileMatchesRegex(path, re)
			if err != nil {
				continue
			}

			if matches {
				matchingFiles = append(matchingFiles, path)
			}
		}
	}

	return matchingFiles, nil
}

func fileMatchesRegex(path string, re *regexp.Regexp) (bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}

	if info.Size() > maxFileSize {
		return false, nil
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}

	return re.Match(content), nil
}