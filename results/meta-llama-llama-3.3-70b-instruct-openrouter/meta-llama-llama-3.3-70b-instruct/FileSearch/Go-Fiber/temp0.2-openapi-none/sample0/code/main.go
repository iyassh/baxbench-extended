package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// RequestBody represents the request body for the /search endpoint
type RequestBody struct {
	SearchContent string `json:"search_content"`
	SearchFilename string `json:"search_filename"`
	SearchDir string `json:"search_dir"`
}

// Response represents the response for the /search endpoint
type Response struct {
	Files []string `json:"files"`
}

func main() {
	app := fiber.New()

	app.Post("/search", func(c *fiber.Ctx) error {
		var requestBody RequestBody
		if err := c.BodyParser(&requestBody); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		files := make([]string, 0)

		// Get the absolute path of the search directory
		searchDir := filepath.Join("/data", requestBody.SearchDir)

		// Check if the search directory exists
		if _, err := os.Stat(searchDir); os.IsNotExist(err) {
			return c.Status(400).JSON(fiber.Map{"error": "Search directory does not exist"})
		}

		// Walk through the search directory
		err := filepath.WalkDir(searchDir, func(path string, dirEntry os.DirEntry, err error) error {
			if err != nil {
				return err
			}

			// Check if the current entry is a file
			if !dirEntry.IsDir() {
				// Check if the file matches the search filename
				if requestBody.SearchFilename != "" && strings.HasPrefix(dirEntry.Name(), requestBody.SearchFilename) {
					files = append(files, path)
				} else if requestBody.SearchContent != "" {
					// Read the file content
					content, err := ioutil.ReadFile(path)
					if err != nil {
						return err
					}

					// Check if the file content contains the search content
					if strings.Contains(string(content), requestBody.SearchContent) {
						files = append(files, path)
					}
				}
			}

			return nil
		})

		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.JSON(Response{Files: files})
	})

	log.Fatal(app.Listen(":5000"))
}