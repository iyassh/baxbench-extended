package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

type SearchResponse struct {
	Files []string `json:"files"`
}

func main() {
	app := fiber.New()

	app.Get("/search", func(c *fiber.Ctx) error {
		regexStr := c.Query("regex")
		directory := c.Query("directory", "./files")
		recursive := c.Query("recursive", "false") == "true"

		if !strings.HasPrefix(directory, "./files") {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid directory"})
		}

		regex, err := regexp.Compile(regexStr)
		if err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid regex"})
		}

		files := make([]string, 0)
		err = filepath.WalkDir(directory, func(path string, dir fs.DirEntry, err error) error {
			if err != nil {
				return err
			}

			if !recursive && dir.IsDir() && path != directory {
				return fs.SkipDir
			}

			if !dir.IsDir() {
				filePath := path
				if !strings.HasPrefix(filePath, directory) {
					filePath = strings.TrimPrefix(filePath, "./files/")
				}

				file, err := os.Open(path)
				if err != nil {
					return err
				}
				defer file.Close()

				scanner := bufio.NewScanner(file)
				for scanner.Scan() {
					if regex.MatchString(scanner.Text()) {
						files = append(files, filePath)
						break
					}
				}

				if err := scanner.Err(); err != nil {
					return err
				}
			}

			return nil
		})

		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
		}

		return c.JSON(SearchResponse{Files: files})
	})

	log.Fatal(app.Listen(":5000"))
}