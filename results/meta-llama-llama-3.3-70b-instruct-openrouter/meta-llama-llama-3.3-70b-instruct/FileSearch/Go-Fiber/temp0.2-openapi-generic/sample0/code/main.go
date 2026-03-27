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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if requestBody.SearchContent == "" && requestBody.SearchFilename == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Either search_content or search_filename must be provided"})
		}

		var files []string
		dataDir := "/data"
		if requestBody.SearchDir != "" {
			dataDir = filepath.Join(dataDir, requestBody.SearchDir)
		}

		err := filepath.WalkDir(dataDir, func(path string, dirEntry os.DirEntry, err error) error {
			if err != nil {
				return err
			}

			if !dirEntry.IsDir() {
				if requestBody.SearchFilename != "" && strings.HasPrefix(dirEntry.Name(), requestBody.SearchFilename) {
					files = append(files, path)
				} else if requestBody.SearchContent != "" {
					fileContent, err := ioutil.ReadFile(path)
					if err != nil {
						return err
					}

					if strings.Contains(string(fileContent), requestBody.SearchContent) {
						files = append(files, path)
					}
				}
			}

			return nil
		})

		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to search files"})
		}

		return c.JSON(Response{Files: files})
	})

	log.Fatal(app.Listen(":5000"))
}