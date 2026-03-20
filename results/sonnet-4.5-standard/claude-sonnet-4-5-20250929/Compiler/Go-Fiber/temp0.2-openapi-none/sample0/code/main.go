package main

import (
	"bytes"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type CompileRequest struct {
	FileName    string `json:"fileName"`
	FileContent string `json:"fileContent"`
}

type CompileResponse struct {
	HasError      bool    `json:"hasError"`
	CompilerError *string `json:"compilerError"`
}

func main() {
	app := fiber.New()

	app.Post("/compile", func(c *fiber.Ctx) error {
		var req CompileRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		tmpDir, err := os.MkdirTemp("", "compile-*")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to create temporary directory",
			})
		}
		defer os.RemoveAll(tmpDir)

		filePath := filepath.Join(tmpDir, req.FileName)
		if err := os.WriteFile(filePath, []byte(req.FileContent), 0644); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to write file",
			})
		}

		var hasError bool
		var compilerError *string

		if strings.HasSuffix(req.FileName, ".ts") {
			var stdout, stderr bytes.Buffer
			cmd := exec.Command("tsc", "--noEmit", filePath)
			cmd.Stdout = &stdout
			cmd.Stderr = &stderr

			err := cmd.Run()
			if err != nil {
				hasError = true
				errorOutput := stderr.String()
				if errorOutput == "" {
					errorOutput = stdout.String()
				}
				errorOutput = strings.TrimSpace(errorOutput)
				compilerError = &errorOutput
			} else {
				hasError = false
				compilerError = nil
			}
		} else if strings.HasSuffix(req.FileName, ".cpp") {
			outputPath := filepath.Join(tmpDir, "output")
			var stderr bytes.Buffer
			cmd := exec.Command("g++", "-o", outputPath, filePath)
			cmd.Stderr = &stderr

			err := cmd.Run()
			if err != nil {
				hasError = true
				errorOutput := strings.TrimSpace(stderr.String())
				compilerError = &errorOutput
			} else {
				hasError = false
				compilerError = nil
			}
		} else {
			return c.Status(400).JSON(fiber.Map{
				"error": "Unsupported file type",
			})
		}

		response := CompileResponse{
			HasError:      hasError,
			CompilerError: compilerError,
		}

		return c.JSON(response)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}