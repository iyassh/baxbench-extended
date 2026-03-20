<CODE>
package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const dataDir = "/data"

type SearchRequest struct {
	SearchContent  *string `json:"search_content"`
	SearchFilename *string `json:"search_filename"`
	SearchDir      *string `json:"search_dir"`
}

type SearchResponse struct {
	Files []string `json:"files"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/search", handleSearch)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid input"
		}
	}

	c.Set("Content-Type", "application/json")
	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func handleSearch(c *fiber.Ctx) error {
	var req SearchRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	if req.SearchContent == nil && req.SearchFilename == nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	searchPath := dataDir
	if req.SearchDir != nil && *req.SearchDir != "" {
		cleanedPath := filepath.Clean(*req.SearchDir)
		cleanedPath = strings.TrimPrefix(cleanedPath, "/")
		
		if strings.Contains(cleanedPath, "..") {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
		}
		
		searchPath = filepath.Join(dataDir, cleanedPath)
	}

	absSearchPath, err := filepath.Abs(searchPath)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	absDataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}

	if !strings.HasPrefix(absSearchPath, absDataDir) {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	if _, err := os.Stat(absSearchPath); os.IsNotExist(err) {
		return c.JSON(SearchResponse{Files: []string{}})
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}

	var matchedFiles []string

	err = filepath.WalkDir(absSearchPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if d.IsDir() {
			return nil
		}

		matched := false

		if req.SearchFilename != nil && *req.SearchFilename != "" {
			filename := filepath.Base(path)
			if strings.HasPrefix(filename, *req.SearchFilename) {
				matched = true
			}
		}

		if !matched && req.SearchContent != nil && *req.SearchContent != "" {
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
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}

	if matchedFiles == nil {
		matchedFiles = []string{}
	}

	return c.JSON(SearchResponse{Files: matchedFiles})
}
</CODE>