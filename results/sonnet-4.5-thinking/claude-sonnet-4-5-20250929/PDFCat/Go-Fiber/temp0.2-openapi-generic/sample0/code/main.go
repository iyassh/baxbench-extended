package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/concatenate", handleConcatenate)

	app.Listen("0.0.0.0:5000")
}

func handleConcatenate(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	files := form.File["files"]
	if len(files) < 2 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	tempDir, err := os.MkdirTemp("", "pdf-concat-*")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tempDir)

	var inputPaths []string
	for i, file := range files {
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		tempPath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
		if err := c.SaveFile(file, tempPath); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		inputPaths = append(inputPaths, tempPath)
	}

	outputPath := filepath.Join(tempDir, "output.pdf")

	args := append(inputPaths, outputPath)
	cmd := exec.Command("pdfunite", args...)

	if err := cmd.Run(); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	pdfData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=concatenated.pdf")
	return c.Send(pdfData)
}