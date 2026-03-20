<CODE>
package main

import (
	"archive/zip"
	"bytes"
	"io"
	"log"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB limit
	})

	app.Post("/convert", convertHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertHandler(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: no file provided")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot open file")
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot read file")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: not a valid zip file")
	}

	var result strings.Builder

	for _, f := range zipReader.File {
		if f.FileInfo().IsDir() {
			continue
		}

		ext := strings.ToLower(filepath.Ext(f.Name))
		if ext != ".txt" && ext != ".md" && ext != ".log" && ext != ".csv" && ext != ".json" && ext != ".xml" && ext != ".html" && ext != ".css" && ext != ".js" && ext != ".py" && ext != ".go" && ext != ".java" && ext != ".c" && ext != ".cpp" && ext != ".h" && ext != ".sh" && ext != ".yml" && ext != ".yaml" && ext != ".ini" && ext != ".cfg" && ext != ".conf" && ext != "" {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			continue
		}

		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}

		result.WriteString("=== ")
		result.WriteString(f.Name)
		result.WriteString(" ===\n")
		result.Write(content)
		result.WriteString("\n\n")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}
</CODE>