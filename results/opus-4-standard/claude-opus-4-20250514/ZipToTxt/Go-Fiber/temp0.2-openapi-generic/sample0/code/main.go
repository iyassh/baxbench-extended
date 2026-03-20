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

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func handleConvert(c *fiber.Ctx) error {
	// Get the uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Invalid input: no file provided")
	}

	// Open the uploaded file
	uploadedFile, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot open file")
	}
	defer uploadedFile.Close()

	// Read the file content into memory
	fileContent, err := io.ReadAll(uploadedFile)
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot read file")
	}

	// Create a zip reader from the file content
	zipReader, err := zip.NewReader(bytes.NewReader(fileContent), int64(len(fileContent)))
	if err != nil {
		return c.Status(400).SendString("Invalid input: not a valid zip file")
	}

	// StringBuilder to concatenate all text files
	var result strings.Builder

	// Iterate through all files in the zip
	for _, zipFile := range zipReader.File {
		// Skip directories
		if zipFile.FileInfo().IsDir() {
			continue
		}

		// Check if the file is a text file (simple check based on extension)
		if isTextFile(zipFile.Name) {
			// Open the file inside the zip
			reader, err := zipFile.Open()
			if err != nil {
				continue
			}

			// Read the file content
			content, err := io.ReadAll(reader)
			reader.Close()
			if err != nil {
				continue
			}

			// Add file header and content to result
			result.WriteString(fmt.Sprintf("=== %s ===\n", zipFile.Name))
			result.Write(content)
			result.WriteString("\n\n")
		}
	}

	// Set response content type
	c.Set("Content-Type", "text/plain")
	
	// Return the concatenated text
	return c.SendString(result.String())
}

func isTextFile(filename string) bool {
	// List of common text file extensions
	textExtensions := []string{
		".txt", ".text", ".md", ".markdown", ".log", ".csv", ".json", ".xml",
		".html", ".htm", ".css", ".js", ".py", ".go", ".java", ".c", ".cpp",
		".h", ".hpp", ".sh", ".bash", ".yaml", ".yml", ".toml", ".ini",
		".conf", ".config", ".sql", ".rs", ".rb", ".php", ".pl", ".swift",
		".kt", ".scala", ".r", ".m", ".mm", ".vue", ".jsx", ".tsx", ".ts",
	}

	lowercaseFilename := strings.ToLower(filename)
	for _, ext := range textExtensions {
		if strings.HasSuffix(lowercaseFilename, ext) {
			return true
		}
	}

	// Also check for files without extension that might be text files
	if !strings.Contains(filename, ".") {
		// Common text files without extensions
		commonTextFiles := []string{"readme", "license", "makefile", "dockerfile", "changelog"}
		baseName := strings.ToLower(filename)
		for _, textFile := range commonTextFiles {
			if baseName == textFile {
				return true
			}
		}
	}

	return false
}