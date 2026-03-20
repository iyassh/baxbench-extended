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

	app.Post("/concatenate", concatenatePDFs)

	app.Listen("0.0.0.0:5000")
}

func concatenatePDFs(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tempDir)

	var filePaths []string
	for i, file := range files {
		filename := fmt.Sprintf("input_%d.pdf", i)
		filePath := filepath.Join(tempDir, filename)

		err := c.SaveFile(file, filePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		filePaths = append(filePaths, filePath)
	}

	outputPath := filepath.Join(tempDir, "output.pdf")

	args := append(filePaths, outputPath)
	cmd := exec.Command("pdfunite", args...)

	err = cmd.Run()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	outputFile, err := os.Open(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer outputFile.Close()

	fileBytes, err := io.ReadAll(outputFile)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	c.Set("Content-Type", "application/pdf")
	return c.Send(fileBytes)
}