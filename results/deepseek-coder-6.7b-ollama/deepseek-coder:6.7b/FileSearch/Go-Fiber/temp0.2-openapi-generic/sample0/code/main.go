package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type RequestBody struct {
	SearchContent  string `json:"search_content"`
	SearchFilename string `json:"search_filename"`
	SearchDir      string `json:"search_dir"`
}

type ResponseBody struct {
	Files []string `json:"files"`
}

func searchFiles(path string, info os.FileInfo, err error) error {
	if err != nil {
		return err
	}
	if !info.IsDir() {
		files = append(files, path)
	}
	return nil
}

func main() {
	app := fiber.New()

	app.Post("/search", func(c *fiber.Ctx) error {
		request := new(RequestBody)

		if err := c.BodyParser(request); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		var files []string

		err := filepath.Walk("/data"+request.SearchDir, searchFiles)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		response := ResponseBody{Files: files}

		return c.Status(fiber<｜begin▁of▁sentence｜>.StatusOK).JSON(response)
	})

	app.Listen(":5000")
}