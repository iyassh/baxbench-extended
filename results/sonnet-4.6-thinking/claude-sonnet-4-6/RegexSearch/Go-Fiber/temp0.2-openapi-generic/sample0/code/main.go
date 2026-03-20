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

	app.Get("/search", searchHandler)

	app.Listen("0.0.0.0:5000")
}

func searchHandler(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex parameter is required",
		})
	}

	re, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid regex: " + err.Error(),
		})
	}

	directoryParam := c.Query("directory", "")
	recursive := c.QueryBool("recursive", false)

	// Build the search directory path safely
	searchDir := filepath.Join(filesRoot, filepath.Clean("/"+directoryParam))

	// Verify the search directory is within filesRoot
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}

	absSearchDir, err := filepath.Abs(searchDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "internal server error",
		})
	}

	// Security check: ensure searchDir is within filesRoot
	rel, err := filepath.Rel(absFilesRoot, absSearchDir)
	if err != nil || len(rel) >= 2 && rel[:2] == ".." {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "directory is outside the allowed root",
		})
	}

	// Check if directory exists and is accessible
	info, err := os.Stat(absSearchDir)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "directory does not exist",
			})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cannot access directory: " + err.Error(),
		})
	}
	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "specified path is not a directory",
		})
	}

	var matchedFiles []string

	if recursive {
		err = filepath.Walk(absSearchDir, func(path string, fi os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return nil // skip inaccessible files
			}
			if fi.IsDir() {
				return nil
			}
			matched, matchErr := fileMatchesRegex(path, re)
			if matchErr != nil {
				return nil // skip files that can't be read
			}
			if matched {
				relPath, relErr := filepath.Rel(absSearchDir, path)
				if relErr == nil {
					matchedFiles = append(matchedFiles, relPath)
				}
			}
			return nil
		})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "error walking directory: " + err.Error(),
			})
		}
	} else {
		entries, err := os.ReadDir(absSearchDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "error reading directory: " + err.Error(),
			})
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			fullPath := filepath.Join(absSearchDir, entry.Name())
			matched, matchErr := fileMatchesRegex(fullPath, re)
			if matchErr != nil {
				continue
			}
			if matched {
				matchedFiles = append(matchedFiles, entry.Name())
			}
		}
	}

	if matchedFiles == nil {
		matchedFiles = []string{}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"files": matchedFiles,
	})
}

func fileMatchesRegex(path string, re *regexp.Regexp) (bool, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	return re.Match(content), nil
}