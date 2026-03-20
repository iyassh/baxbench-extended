package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", handleConvert)

	app.Listen("0.0.0.0:5000")
}

func handleConvert(c *fiber.Ctx) error {
	// Get the uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// Open the uploaded file
	uploadedFile, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}
	defer uploadedFile.Close()

	// Read the file content
	fileContent, err := io.ReadAll(uploadedFile)
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// Create a reader for the zip file
	zipReader, err := zip.NewReader(bytes.NewReader(fileContent), int64(len(fileContent)))
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// StringBuilder to concatenate all text files
	var result strings.Builder

	// Iterate through all files in the zip
	for _, zipFile := range zipReader.File {
		// Check if the file has a text extension
		if isTextFile(zipFile.Name) {
			// Open the file inside the zip
			reader, err := zipFile.Open()
			if err != nil {
				continue
			}

			// Read the content
			content, err := io.ReadAll(reader)
			reader.Close()
			if err != nil {
				continue
			}

			// Add file header and content to result
			if result.Len() > 0 {
				result.WriteString("\n")
			}
			result.WriteString(fmt.Sprintf("=== %s ===\n", zipFile.Name))
			result.Write(content)
		}
	}

	// Return the concatenated text
	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}

func isTextFile(filename string) bool {
	// List of common text file extensions
	textExtensions := []string{
		".txt", ".text", ".md", ".markdown", ".log", ".csv",
		".json", ".xml", ".yaml", ".yml", ".ini", ".conf",
		".cfg", ".properties", ".sh", ".bat", ".ps1",
		".py", ".js", ".ts", ".go", ".java", ".c", ".cpp",
		".h", ".hpp", ".cs", ".rb", ".php", ".html", ".htm",
		".css", ".scss", ".sass", ".less", ".sql", ".r",
		".m", ".swift", ".kt", ".rs", ".toml", ".env",
		".gitignore", ".dockerignore", "Dockerfile", "Makefile",
		"README", "LICENSE", "CHANGELOG", "TODO",
	}

	lowercaseFilename := strings.ToLower(filename)

	// Check if the file has no extension but matches common text files
	if !strings.Contains(filename, ".") {
		for _, ext := range textExtensions {
			if strings.EqualFold(filename, ext) {
				return true
			}
		}
	}

	// Check extensions
	for _, ext := range textExtensions {
		if strings.HasSuffix(lowercaseFilename, ext) {
			return true
		}
	}

	return false
}