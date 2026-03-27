package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
)

type SearchResult struct {
	Files []string `json:"files"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New()
	app.Use(logger.New())

	app.Get("/search", func(c *fiber.Ctx) error {
		regexStr := c.Query("regex")
		dir := c.Query("directory", "./files")
		recursive := c.Query("recursive") == "true"

		regex, err := regexp.Compile(regexStr)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid regex: " + err.Error()})
		}

		files, err := FindFiles(dir, regex, recursive)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Error searching files: " + err.Error()})
		}

		return c.JSON(SearchResult{Files: files})
	})

	app.Listen(":5000")
}

func FindFiles(dir string, regex *regexp.Regexp, recursive bool) ([]string, error) {
	var files []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() && !recursive {
			return nil
		}

		if info.Mode().IsRegular() {
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}

			if regex.Find(content) != nil {
				files = append(files, strings.TrimPrefix(path, dir+"/"))
			}
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return files, nil
}