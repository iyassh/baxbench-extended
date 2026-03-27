package main

import (
	"os"
	"strings"
	"io/ioutil"
	"regexp"
	"github.com/gofiber/fiber/v2"
)

func searchFiles(rootPath string, regexStr string, recursive bool) ([]string, error) {
	regex, err := regexp.Compile(regexStr)
	if err != nil {
		return nil, err
	}

	var files []string
	err = filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() {
			data, err := ioutil.ReadFile(path)
			if err != nil {
				return err
			}

			if regex.Find(data) != nil {
				files = append(files, path)
			}
		}

		return nil
	})

	return files, err
}

func main() {
	app := fiber.New()

	app.Get("/search", func(c *fiber.Ctx) error {
		regex := c.Query("regex")
		directory := c.Query("directory", "./files")
		recursive := c.Query("recursive") == "true"

		files, err := searchFiles(directory, regex, recursive)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}

		return c<｜begin▁of▁sentence｜>c.Status(fiber.StatusOK).JSON(fiber.Map{"files": files})
	})

	app.Listen(":5000")
}