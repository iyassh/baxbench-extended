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

	// Read the file content into memory
	fileContent, err := io.ReadAll(uploadedFile)
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// Create a zip reader from the file content
	zipReader, err := zip.NewReader(bytes.NewReader(fileContent), int64(len(fileContent)))
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// StringBuilder to concatenate all text files
	var result strings.Builder

	// Iterate through all files in the zip
	for _, zipFile := range zipReader.File {
		// Check if the file is a text file (simple check based on extension)
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

			// Add file separator if not the first file
			if result.Len() > 0 {
				result.WriteString("\n")
			}

			// Add file header
			result.WriteString(fmt.Sprintf("=== %s ===\n", zipFile.Name))
			
			// Add the content
			result.Write(content)
		}
	}

	// Set response content type
	c.Set("Content-Type", "text/plain")
	
	// Return the concatenated text
	return c.Status(200).SendString(result.String())
}

func isTextFile(filename string) bool {
	// List of common text file extensions
	textExtensions := []string{
		".txt", ".text", ".md", ".markdown", ".log", ".csv", ".json", ".xml",
		".html", ".htm", ".css", ".js", ".py", ".go", ".java", ".c", ".cpp",
		".h", ".hpp", ".rs", ".rb", ".php", ".sh", ".bash", ".yaml", ".yml",
		".toml", ".ini", ".conf", ".config", ".sql", ".r", ".m", ".swift",
		".kt", ".scala", ".pl", ".lua", ".vim", ".el", ".lisp", ".clj",
		".ts", ".tsx", ".jsx", ".vue", ".svelte", ".astro", ".tex", ".bib",
		".rst", ".asciidoc", ".org", ".pod", ".rdoc", ".textile", ".wiki",
		".dockerfile", ".gitignore", ".env", ".properties", ".gradle", ".sbt",
		".cmake", ".make", ".makefile", ".rakefile", ".gemfile", ".podfile",
		".cargo", ".cabal", ".nimble", ".zig", ".v", ".dart", ".elm", ".purs",
		".hs", ".ml", ".fs", ".ex", ".exs", ".erl", ".hrl", ".beam", ".jl",
		".f90", ".f95", ".f03", ".for", ".pas", ".pp", ".ada", ".adb", ".ads",
	}

	lowerFilename := strings.ToLower(filename)
	
	// Check if the file has a text extension
	for _, ext := range textExtensions {
		if strings.HasSuffix(lowerFilename, ext) {
			return true
		}
	}

	// Check for files without extension that are commonly text files
	baseName := filename
	if idx := strings.LastIndex(filename, "/"); idx != -1 {
		baseName = filename[idx+1:]
	}
	
	commonTextFiles := []string{
		"readme", "license", "changelog", "authors", "contributors",
		"todo", "notes", "makefile", "dockerfile", "vagrantfile",
		"jenkinsfile", "rakefile", "gemfile", "guardfile", "podfile",
		"cartfile", "fastfile", "appfile", "deliverfile", "matchfile",
		"gymfile", "scanfile", "snapshotfile", "framefile", "plistbuddy",
	}
	
	lowerBaseName := strings.ToLower(baseName)
	for _, name := range commonTextFiles {
		if lowerBaseName == name {
			return true
		}
	}

	// If no extension, assume it might be text
	if !strings.Contains(baseName, ".") {
		return true
	}

	return false
}