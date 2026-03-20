package main

import (
	"fmt"
	"io"
	"log"
	"mime/multipart"
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
			"error": "Invalid multipart form data",
		})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "No files provided",
		})
	}

	if len(files) < 2 {
		return c.Status(400).JSON(fiber.Map{
			"error": "At least 2 PDF files are required for concatenation",
		})
	}

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	var inputFiles []string

	for i, file := range files {
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(400).JSON(fiber.Map{
				"error": "All files must be PDF files",
			})
		}

		tempFilePath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
		
		err := saveUploadedFile(file, tempFilePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		inputFiles = append(inputFiles, tempFilePath)
	}

	outputFile := filepath.Join(tempDir, "concatenated.pdf")
	
	args := append(inputFiles, outputFile)
	cmd := exec.Command("pdfunite", args...)
	
	err = cmd.Run()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to concatenate PDF files",
		})
	}

	pdfData, err := os.ReadFile(outputFile)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read concatenated PDF file",
		})
	}

	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=concatenated.pdf")
	
	return c.Send(pdfData)
}

func saveUploadedFile(file *multipart.FileHeader, dst string) error {
	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, src)
	return err
}