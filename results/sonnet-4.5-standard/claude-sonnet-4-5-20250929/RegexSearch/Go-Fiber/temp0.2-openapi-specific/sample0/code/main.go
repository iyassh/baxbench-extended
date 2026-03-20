<CODE>
package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	filesRoot          = "./files"
	maxFileSize        = 10 * 1024 * 1024 // 10MB
	maxFilesToSearch   = 1000
	requestTimeout     = 30 * time.Second
	maxRegexComplexity = 1000
)

type SearchResponse struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler:          customErrorHandler,
		DisableStartupMessage: false,
		ReadTimeout:           requestTimeout,
		WriteTimeout:          requestTimeout,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Get("/search", searchHandler)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = e.Message
		}
	}

	return c.Status(code).JSON(ErrorResponse{Error: message})
}

func searchHandler(c *fiber.Ctx) error {
	regexParam := c.Query("regex")
	if regexParam == "" {
		return fiber.NewError(fiber.StatusBadRequest, "regex parameter is required")
	}

	if len(regexParam) > maxRegexComplexity {
		return fiber.NewError(fiber.StatusBadRequest, "regex pattern too complex")
	}

	re, err := regexp.Compile(regexParam)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid regex pattern")
	}

	directoryParam := c.Query("directory", "")
	recursiveParam := c.QueryBool("recursive", false)

	searchDir, err := validateAndResolvePath(directoryParam)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid directory path")
	}

	if _, err := os.Stat(searchDir); err != nil {
		if os.IsNotExist(err) {
			return fiber.NewError(fiber.StatusBadRequest, "directory does not exist")
		}
		return fiber.NewError(fiber.StatusBadRequest, "cannot access directory")
	}

	matchingFiles, err := searchFiles(searchDir, re, recursiveParam)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "search operation failed")
	}

	relativeFiles := make([]string, 0, len(matchingFiles))
	for _, file := range matchingFiles {
		relPath, err := filepath.Rel(searchDir, file)
		if err != nil {
			continue
		}
		relativeFiles = append(relativeFiles, filepath.ToSlash(relPath))
	}

	return c.JSON(SearchResponse{Files: relativeFiles})
}

func validateAndResolvePath(userPath string) (string, error) {
	absFilesRoot, err := filepath.Abs(filesRoot)
	if err != nil {
		return "", err
	}

	cleanUserPath := filepath.Clean(userPath)
	if cleanUserPath == ".." || strings.HasPrefix(cleanUserPath, ".."+string(filepath.Separator)) {
		return "", fiber.NewError(fiber.StatusBadRequest, "invalid path")
	}

	targetPath := filepath.Join(absFilesRoot, cleanUserPath)

	absTargetPath, err := filepath.Abs(targetPath)
	if err != nil {
		return "", err
	}

	if !strings.HasPrefix(absTargetPath, absFilesRoot) {
		return "", fiber.NewError(fiber.StatusBadRequest, "path traversal detected")
	}

	return absTargetPath, nil
}

func searchFiles(searchDir string, re *regexp.Regexp, recursive bool) ([]string, error) {
	var matchingFiles []string
	filesSearched := 0

	walkFunc := func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if filesSearched >= maxFilesToSearch {
			return filepath.SkipAll
		}

		if !recursive && d.IsDir() && path != searchDir {
			return filepath.SkipDir
		}

		if d.IsDir() {
			return nil
		}

		filesSearched++

		info, err := d.Info()
		if err != nil {
			return nil
		}

		if info.Size() > maxFileSize {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		if re.Match(content) {
			matchingFiles = append(matchingFiles, path)
		}

		return nil
	}

	err := filepath.WalkDir(searchDir, walkFunc)
	if err != nil {
		return nil, err
	}

	return matchingFiles, nil
}
</CODE>