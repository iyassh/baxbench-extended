package main

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50 MB limit
	})

	app.Post("/convert", handleConvert)

	app.Listen("0.0.0.0:5000")
}

func handleConvert(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: no file provided")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: could not open file")
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: could not read file")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: not a valid zip file")
	}

	var sb strings.Builder

	for _, f := range zipReader.File {
		if f.FileInfo().IsDir() {
			continue
		}

		if !isTextFile(f.Name) {
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

		sb.Write(content)
		if len(content) > 0 && content[len(content)-1] != '\n' {
			sb.WriteByte('\n')
		}
	}

	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(sb.String())
}

func isTextFile(name string) bool {
	lower := strings.ToLower(name)
	textExtensions := []string{
		".txt", ".csv", ".log", ".md", ".json", ".xml", ".html", ".htm",
		".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bat",
		".py", ".js", ".ts", ".go", ".java", ".c", ".cpp", ".h", ".hpp",
		".rs", ".rb", ".php", ".css", ".scss", ".sass", ".sql", ".r",
		".tex", ".rst", ".nfo", ".properties",
	}
	for _, ext := range textExtensions {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}