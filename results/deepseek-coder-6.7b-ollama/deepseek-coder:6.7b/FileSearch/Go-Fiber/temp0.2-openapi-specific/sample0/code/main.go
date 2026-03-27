package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"

	"github.<｜begin▁of▁sentence｜>/fiber/fiber/v2"
)

type RequestBody struct {
	SearchContent string `json:"search_content"`
	SearchFilename string `json:"search_filename"`
	SearchDir string `json:"search_dir"`
}

type ResponseBody struct {
	Files []string `json:"files"`
}

func searchFiles(path string, info os.FileInfo, err error) error {
	if err != nil {
		return err
	}
	if !info.IsDir() {
		data, err := ioutil.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(data), reqBody.SearchContent) || strings.Contains(info.Name(), reqBody.SearchFilename) {
			resBody.Files = append(resBody.Files, path)
		}
	}
	return nil
}

var reqBody RequestBody
var resBody ResponseBody

func main() {
	app := fiber.New()

	app.Post("/search", func(c *fiber.Ctx) error {
		var err error
		reqBody = RequestBody{}
		resBody = ResponseBody{}

		err = c.BodyParser(&reqBody)
		if err != nil {
			c.Status(400).SendString(err.Error())
			return err
		}

		searchDir := "/data" + reqBody.SearchDir

		err = filepath.Walk(searchDir, searchFiles)
		if err != nil {
			c.Status(400).SendString(err.Error())
			return err
		}

		return c.JSON(resBody)
	})

	app.Listen(":5000")
}