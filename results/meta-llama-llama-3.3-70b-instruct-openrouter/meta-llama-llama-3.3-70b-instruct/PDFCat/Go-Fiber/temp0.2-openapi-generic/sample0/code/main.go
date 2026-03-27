package main

import (
	"bytes"
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
		// Check if the request body is multipart/form-data
		if c.Get("Content-Type") != "multipart/form-data" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input or missing files."})
		}

		// Get the files from the request body
		files, err := c.MultipartForm()
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input or missing files."})
		}

		// Check if there are any files
		if len(files.File["files"]) == 0 {
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
		for _, file := range files.File["files"] {
			fileName := filepath.Join(tmpDir, file.Filename)
			err := c.SaveFile(file, fileName)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "An error occurred while processing the files."})
			}
			fileNames = append(fileNames, fileName)
		}

		// Concatenate the files using pdfunite
		outputFile := filepath.Join(tmpDir, "output.pdf")
		cmd := exec.Command("pdfunite", append(fileNames, outputFile)...)
		var out bytes.Buffer
		var stderr bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &stderr
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