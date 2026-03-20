package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).SendString("Invalid input: no file provided")
		}

		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(400).SendString("Invalid input: cannot open file")
		}
		defer file.Close()

		buf := new(bytes.Buffer)
		if _, err := io.Copy(buf, file); err != nil {
			return c.Status(400).SendString("Invalid input: cannot read file")
		}

		zipReader, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
		if err != nil {
			return c.Status(400).SendString("Invalid input: not a valid zip file")
		}

		var result strings.Builder

		for _, f := range zipReader.File {
			// Skip directories
			if f.FileInfo().IsDir() {
				continue
			}

			// Check if it's a text file by extension
			ext := strings.ToLower(filepath.Ext(f.Name))
			if ext != ".txt" && ext != ".text" && ext != ".md" && ext != ".csv" &&
				ext != ".log" && ext != ".json" && ext != ".xml" && ext != ".html" &&
				ext != ".css" && ext != ".js" && ext != ".py" && ext != ".go" &&
				ext != ".java" && ext != ".c" && ext != ".h" && ext != ".cpp" &&
				ext != ".rs" && ext != ".ts" && ext != ".yaml" && ext != ".yml" &&
				ext != ".toml" && ext != ".ini" && ext != ".cfg" && ext != ".conf" &&
				ext != ".sh" && ext != ".bat" && ext != ".ps1" && ext != ".rb" &&
				ext != ".pl" && ext != ".php" && ext != ".sql" && ext != ".r" &&
				ext != ".swift" && ext != ".kt" && ext != ".scala" && ext != ".lua" &&
				ext != "" {
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

			// Check if content is text (no null bytes in first chunk)
			isText := true
			checkLen := len(content)
			if checkLen > 512 {
				checkLen = 512
			}
			for _, b := range content[:checkLen] {
				if b == 0 {
					isText = false
					break
				}
			}
			if !isText {
				continue
			}

			if result.Len() > 0 {
				result.WriteString(fmt.Sprintf("\n--- %s ---\n", f.Name))
			} else {
				result.WriteString(fmt.Sprintf("--- %s ---\n", f.Name))
			}
			result.Write(content)
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(result.String())
	})

	app.Listen("0.0.0.0:5000")
}