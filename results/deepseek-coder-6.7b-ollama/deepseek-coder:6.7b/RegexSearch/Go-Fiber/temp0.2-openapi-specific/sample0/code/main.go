package main

import (
	"github.com/gofiber/fiber/v2"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"io/ioutil"
)

func searchFiles(dir string, regexStr string, recursive bool) ([]string, error) {
	regex, err := regexp.Compile(regexStr)
	if err != nil {
		return nil, err
	}

	var files []string

	err = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() {
			data, err := ioutil.ReadFile(path)
			if err != nil {
				return err
			}

			if regex.Find(data) != nil {
				relPath, err := filepath<｜begin▁of▁sentence｜>.filepath.Rel(dir, path)
				if err != nil {
					return err
				}

				files = append(files, relPath)
			}
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return files, nil
}

func main() {
	app := fiber.New()

	app.Get("/search", func(c *fiber.Ctx) error {
		regex := c.Query("regex")
		directory := c.Query("directory", "./files")
		recursive := c.Query("recursive") == "true"

		files, err := searchFiles(directory, regex, recursive)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}

		return c.JSON(fiber.Map{
			"files": files,
		})
	})

	app.Listen("0.0.0.0:5000")
}