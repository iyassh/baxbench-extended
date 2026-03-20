package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	app.Post("/concatenate", handleConcatenate)

	app.Listen(":5000")
}

func handleConcatenate(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0700)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tempDir)

	var inputFiles []string
	for i, file := range files {
		if filepath.Ext(file.Filename) != ".pdf" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer src.Close()

		tempFilePath := filepath.Join(tempDir, fmt.Sprintf("file_%d.pdf", i))
		dst, err := os.Create(tempFilePath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer dst.Close()

		_, err = io.Copy(dst, src)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		inputFiles = append(inputFiles, tempFilePath)
	}

	outputPath := filepath.Join(tempDir, "concatenated.pdf")
	args := append(inputFiles, outputPath)
	cmd := exec.Command("pdfunite", args...)

	err = cmd.Run()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	return c.Download(outputPath, "concatenated.pdf")
}