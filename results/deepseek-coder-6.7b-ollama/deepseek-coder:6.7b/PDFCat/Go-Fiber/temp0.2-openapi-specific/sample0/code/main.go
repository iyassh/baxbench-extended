package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
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

		tempDir := os.TempDir()
		tempFiles := make([]string, len(files))

		for i, file := range files {
			uuid, err := uuid.NewUUID()
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
			}

			tempFile := filepath.Join(tempDir, uuid.String()+".pdf")
			if err := c.SaveFile(file, tempFile); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
			}

			tempFiles[i] = tempFile
		}

		concatenatedFile := filepath.Join(tempDir, "concatenated.pdf")
		cmd := exec.Command("pdfunite", append(tempFiles, concatenatedFile)...)
		err = cmd.Run()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}

		concatenatedPDF, err := ioutil.ReadFile(concatenatedFile)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "An error occurred while processing the files."})
		}

		if err := os.Remove(concatenatedFile); err != nil {
			log.Println("Error removing temporary file:", err)
		}

		for _, file := range tempFiles {
			if err := os.Remove(file); err != nil {
				log.Println("Error removing temporary file:", err)
			}
		}

		return c.Send(concatenatedPDF)
	})

	app.Listen(":5000")
}