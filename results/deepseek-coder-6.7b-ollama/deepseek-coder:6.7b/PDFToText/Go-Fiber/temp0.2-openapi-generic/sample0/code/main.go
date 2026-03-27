package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type Response struct {
	Text string `json:"text"`
}

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Missing file"})
		}

		tempFile, err := ioutil.TempFile("", "")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create temporary file"})
		}
		defer os.Remove(tempFile.Name())

		if err := c.SaveFile(file, tempFile.Name()); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to save file"})
		}

		output, err := exec.Command("pdftotext", tempFile.Name(), "-").Output()
		if err != nil {
			return c.Status(500).JSON(fiber<｜begin▁of▁sentence｜>.Map{"error": "Failed to convert PDF to text"})
		}

		return c.Status(200).JSON(Response{Text: string(output)})
	})

	app.Listen(":5000")
}