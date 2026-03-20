package main

import (
	"fmt"
	"io"
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

	app.Post("/concatenate", concatenatePDFs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
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

	tempDir := fmt.Sprintf("/tmp/pdf_concat_%s", uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tempDir)

	var inputFiles []string
	for i, file := range files {
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		tempFilePath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
		
		src, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		dst, err := os.Create(tempFilePath)
		if err != nil {
			src.Close()
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		_, err = io.Copy(dst, src)
		src.Close()
		dst.Close()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		inputFiles = append(inputFiles, tempFilePath)
	}

	outputFile := filepath.Join(tempDir, "concatenated.pdf")
	
	cmdArgs := append(inputFiles, outputFile)
	cmd := exec.Command("pdfunite", cmdArgs...)
	
	err = cmd.Run()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	return c.SendFile(outputFile)
}