package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type SearchRequest struct {
	SearchContent  *string `json:"search_content"`
	SearchFilename *string `json:"search_filename"`
	SearchDir      *string `json:"search_dir"`
}

type SearchResponse struct {
	Files []string `json:"files"`
}

const baseDir = "/data"

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/search", searchHandler)

	err := app.Listen("0.0.0.0:5000")
	if err != nil {
		panic(err)
	}
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}

	return c.Status(code).JSON(fiber.Map{
		"error": "An error occurred processing your request",
	})
}

func searchHandler(c *fiber.Ctx) error {
	var req SearchRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	contentProvided := req.SearchContent != nil && *req.SearchContent != ""
	filenameProvided := req.SearchFilename != nil && *req.SearchFilename != ""

	if !contentProvided && !filenameProvided {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "At least one search parameter is required",
		})
	}

	searchPath := baseDir
	if req.SearchDir != nil && *req.SearchDir != "" {
		cleanedPath := filepath.Clean(*req.SearchDir)
		cleanedPath = strings.TrimPrefix(cleanedPath, "/")
		searchPath = filepath.Join(baseDir, cleanedPath)
	}

	absSearchPath, err := filepath.Abs(searchPath)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid search directory",
		})
	}

	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred processing your request",
		})
	}

	rel, err := filepath.Rel(absBaseDir, absSearchPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid search directory",
		})
	}

	if _, err := os.Stat(searchPath); os.IsNotExist(err) {
		return c.JSON(SearchResponse{Files: []string{}})
	}

	matchedFiles := make([]string, 0)

	err = filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			return nil
		}

		matched := false

		if filenameProvided {
			if strings.HasPrefix(d.Name(), *req.SearchFilename) {
				matched = true
			}
		}

		if !matched && contentProvided {
			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}

			if strings.Contains(string(content), *req.SearchContent) {
				matched = true
			}
		}

		if matched {
			matchedFiles = append(matchedFiles, path)
		}

		return nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred processing your request",
		})
	}

	return c.JSON(SearchResponse{Files: matchedFiles})
}