package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"os/exec"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/concatenate", func(c *fiber.Ctx) error {
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input or missing files."})
		}

		files := form.File["files"]
		if len(files) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input or missing files."})
		}

		tempFiles := []string{}
		defer func() { // cleanup temp files
			for _, file := range tempFiles {
				os.Remove(file)
			}
		}()

		for _, file := range files {
			tempFile, err := ioutil.TempFile("", "*.pdf")
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
			}
			tempFiles = append(tempFiles, tempFile.Name())

			if err := c.SaveFile(file, tempFile.Name()); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
			}
		}

		outputFile, err := ioutil.TempFile("", "*.pdf")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}
		defer os.Remove(outputFile.Name())

		cmd := exec.Command("pdfunite", append(tempFiles, outputFile.Name())...)
		if err := cmd.Run(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}

		output, err := ioutil.ReadFile(outputFile.Name())
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}

		return c.Type("application/pdf").Send(output)
	})

	app.Listen(":5000")
}