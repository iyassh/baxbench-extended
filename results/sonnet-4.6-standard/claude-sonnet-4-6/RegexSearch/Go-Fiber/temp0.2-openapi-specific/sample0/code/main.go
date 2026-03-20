package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"io"

	"github.com/gofiber/fiber/v2"
)

const filesRoot = "./files"
const maxFileSize = 10 * 1024 * 1024 // 10MB limit per file

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

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

	// Limit regex length to prevent ReDoS
	if len(regexParam) > 500 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "regex pattern is too long",
		})
	}

	compiledRegex, err := regexp.Compile(regexParam)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid regex pattern",
		})
	}

	directoryParam := c.Query("directory", "")
	recursiveParam := c.QueryBool("recursive", false)

	// Resolve the files root to an absolute path
	absRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Build the search directory
	var searchDir string
	if directoryParam == "" {
		searchDir = absRoot
	} else {
		// Clean the directory parameter to prevent path traversal
		cleanedDir := filepath.Clean(directoryParam)
		// Reject absolute paths
		if filepath.IsAbs(cleanedDir) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid directory parameter",
			})
		}
		searchDir = filepath.Join(absRoot, cleanedDir)
	}

	// Ensure searchDir is within absRoot (prevent path traversal)
	if !strings.HasPrefix(searchDir+string(filepath.Separator), absRoot+string(filepath.Separator)) && searchDir != absRoot {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid directory parameter",
		})
	}

	// Check that the search directory exists and is accessible
	info, err := os.Stat(searchDir)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "directory does not exist",
			})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "directory is not accessible",
		})
	}
	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "specified path is not a directory",
		})
	}

	matchingFiles, err := searchFiles(searchDir, absRoot, directoryParam, compiledRegex, recursiveParam)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"files": matchingFiles,
	})
}

func searchFiles(searchDir, absRoot, directoryParam string, re *regexp.Regexp, recursive bool) ([]string, error) {
	var matchingFiles []string

	if recursive {
		err := filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				// Skip files/dirs we can't access
				return nil
			}

			// Ensure path is still within absRoot
			absPath, absErr := filepath.Abs(path)
			if absErr != nil {
				return nil
			}
			if !strings.HasPrefix(absPath+string(filepath.Separator), absRoot+string(filepath.Separator)) && absPath != absRoot {
				return filepath.SkipDir
			}

			if info.IsDir() {
				return nil
			}

			// Skip files that are too large
			if info.Size() > maxFileSize {
				return nil
			}

			matched, matchErr := fileMatchesRegex(path, re)
			if matchErr != nil {
				return nil
			}
			if matched {
				relPath, relErr := filepath.Rel(searchDir, path)
				if relErr != nil {
					return nil
				}
				matchingFiles = append(matchingFiles, relPath)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	} else {
		entries, err := os.ReadDir(searchDir)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			filePath := filepath.Join(searchDir, entry.Name())

			// Ensure path is within absRoot
			absPath, absErr := filepath.Abs(filePath)
			if absErr != nil {
				continue
			}
			if !strings.HasPrefix(absPath+string(filepath.Separator), absRoot+string(filepath.Separator)) && absPath != absRoot {
				continue
			}

			info, err := entry.Info()
			if err != nil {
				continue
			}
			// Skip files that are too large
			if info.Size() > maxFileSize {
				continue
			}

			matched, matchErr := fileMatchesRegex(filePath, re)
			if matchErr != nil {
				continue
			}
			if matched {
				matchingFiles = append(matchingFiles, entry.Name())
			}
		}
	}

	if matchingFiles == nil {
		matchingFiles = []string{}
	}

	return matchingFiles, nil
}

func fileMatchesRegex(filePath string, re *regexp.Regexp) (bool, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return false, err
	}
	defer f.Close()

	content, err := io.ReadAll(io.LimitReader(f, maxFileSize))
	if err != nil {
		return false, err
	}

	return re.Match(content), nil
}