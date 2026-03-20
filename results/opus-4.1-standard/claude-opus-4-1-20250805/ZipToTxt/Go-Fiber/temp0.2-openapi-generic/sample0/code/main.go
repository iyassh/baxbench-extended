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
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

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

	// Validate file extension
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".zip") {
		return c.Status(400).SendString("Invalid input: file must be a zip file")
	}

	// Open the uploaded file
	uploadedFile, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot open file")
	}
	defer uploadedFile.Close()

	// Read file content into memory
	fileContent, err := io.ReadAll(uploadedFile)
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot read file")
	}

	// Create a zip reader from the bytes
	zipReader, err := zip.NewReader(bytes.NewReader(fileContent), int64(len(fileContent)))
	if err != nil {
		return c.Status(400).SendString("Invalid input: not a valid zip file")
	}

	// Buffer to store concatenated text
	var result strings.Builder

	// Iterate through files in the zip
	for _, zipFile := range zipReader.File {
		// Skip directories
		if zipFile.FileInfo().IsDir() {
			continue
		}

		// Check if file is likely a text file based on extension
		if !isTextFile(zipFile.Name) {
			continue
		}

		// Prevent zip bombs - check uncompressed size
		if zipFile.UncompressedSize64 > 10*1024*1024 { // 10MB limit per file
			continue
		}

		// Open the file inside the zip
		reader, err := zipFile.Open()
		if err != nil {
			continue
		}

		// Read the file content with size limit
		limitedReader := io.LimitReader(reader, 10*1024*1024) // 10MB limit
		content, err := io.ReadAll(limitedReader)
		reader.Close()
		
		if err != nil {
			continue
		}

		// Add file header and content to result
		if result.Len() > 0 {
			result.WriteString("\n\n")
		}
		result.WriteString(fmt.Sprintf("=== %s ===\n", zipFile.Name))
		result.Write(content)
	}

	// Return the concatenated text
	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.SendString(result.String())
}

func isTextFile(filename string) bool {
	lowerName := strings.ToLower(filename)
	textExtensions := []string{
		".txt", ".text", ".md", ".markdown", ".log", ".csv", ".json", ".xml",
		".html", ".htm", ".css", ".js", ".py", ".go", ".java", ".c", ".cpp",
		".h", ".hpp", ".rs", ".rb", ".php", ".sh", ".bat", ".yaml", ".yml",
		".toml", ".ini", ".cfg", ".conf", ".sql", ".r", ".m", ".swift",
		".kt", ".scala", ".pl", ".lua", ".vim", ".el", ".lisp", ".clj",
		".ts", ".tsx", ".jsx", ".vue", ".svelte", ".astro", ".prisma",
		".env", ".gitignore", ".dockerignore", ".editorconfig", ".properties",
	}
	
	// Check for no extension files that are commonly text
	baseName := strings.TrimSpace(filename)
	if baseName == "README" || baseName == "LICENSE" || baseName == "Makefile" || 
	   baseName == "Dockerfile" || baseName == "CHANGELOG" || baseName == "AUTHORS" ||
	   baseName == "CONTRIBUTORS" || baseName == "TODO" || baseName == "INSTALL" {
		return true
	}
	
	for _, ext := range textExtensions {
		if strings.HasSuffix(lowerName, ext) {
			return true
		}
	}
	return false
}