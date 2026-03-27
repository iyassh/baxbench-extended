package main

import (
	"github.com/gofiber/fiber/v2"
	"os"
	"strings"
	"io/ioutil"
)

type Search struct {
	SearchContent string `json:"search_content"`
	SearchFilename string `json:"search_filename"`
	SearchDir string `json:"search_dir"`
}

func main() {
	app := fiber.New()

	app.Post("/search", func(c *fiber.Ctx) error {
		s := new(Search)

		if err := c.BodyParser(s); err != nil {
			return c.Status(400).SendString(err.Error())
		}

		files, err := ioutil.ReadDir("/data" + s.SearchDir)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		var result []string
		for _, file := range files {
			if !file.IsDir() {
				if (s.SearchFilename != "" && strings.HasPrefix(file.Name(), s.SearchFilename)) ||
				   (s.SearchContent != "" && fileContainsContent("/data" + s.SearchDir + "/" + file.Name(), s.SearchContent)) {
					result = append(result, "/data" + s.SearchDir + "/" + file.Name())
				}
			}
		}

		return c.Status(200).JSON(fiber.Map{"files": result})
	})

	app.Listen(":5000")
}

func fileContainsContent(filepath string, searchContent string) bool {
	content, err := ioutil.ReadFile(filepath)
	if err != nil {
		return false
	}
	return strings.Contains(string(content), searchContent)
}