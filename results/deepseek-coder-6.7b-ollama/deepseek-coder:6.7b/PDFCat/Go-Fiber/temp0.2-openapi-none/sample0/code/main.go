package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/concatenate", func(c *fiber.Ctx) error {
		files, err := c.FormFiles()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input or missing files."})
		}

		tempDir, err := ioutil.TempDir("", "pdfconcat")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}

		for _, file := range files {
			if err := c.SaveFile(file, tempDir+"/"+file.Filename); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
			}
		}

		output := tempDir + "/output.pdf"
		inputs, err := filepath.Glob(tempDir + "/*.pdf")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}

		cmd := exec.Command("pdfunite", inputs...)
		cmd.Stdout = nil
		cmd.Stderr = nil
		err = cmd.Run()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}

		defer func() {
			err = os.RemoveAll(tempDir)
			if err != nil {
				fmt.Printf("Failed to delete temp directory: %v", err)
			}
		}()

		return c.Download(output, "concatenated.pdf")
	})

	app.Listen("0.0.0.0:5000")
}