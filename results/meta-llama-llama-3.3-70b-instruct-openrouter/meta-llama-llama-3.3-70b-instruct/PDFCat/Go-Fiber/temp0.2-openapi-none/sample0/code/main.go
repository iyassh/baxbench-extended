package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/concatenate", func(c *fiber.Ctx) error {
		// Get the files from the request
		files := c.Request().MultipartForm().File["files"]

		// Check if files are provided
		if len(files) == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input or missing files."})
		}

		// Create a temporary directory to store the files
		tmpDir, err := os.MkdirTemp("", "pdf-concat")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}
		defer os.RemoveAll(tmpDir)

		// Save the files to the temporary directory
		var fileNames []string
		for _, file := range files {
			fileName := filepath.Join(tmpDir, file.Filename)
			fileNames = append(fileNames, fileName)
			err := c.SaveFile(file, fileName)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "An error occurred while processing the files."})
			}
		}

		// Concatenate the files using pdfunite
		outputFile := filepath.Join(tmpDir, "output.pdf")
		cmd := exec.Command("pdfunite", append(fileNames, outputFile)...)
		err = cmd.Run()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}

		// Send the concatenated file as a response
		data, err := os.ReadFile(outputFile)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}
		return c.Status(200).Type("application/pdf").Send(data)
	})

	log.Fatal(app.Listen(":5000"))
}