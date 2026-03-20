package main

import (
	"bytes"
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

func compileCode(fileName, fileContent string) CompileResponse {
	// Create a temporary directory
	tmpDir, err := os.MkdirTemp("", "compilenow-*")
	if err != nil {
		errMsg := "Failed to create temporary directory"
		return CompileResponse{HasError: true, CompilerError: &errMsg}
	}
	defer os.RemoveAll(tmpDir)

	// Sanitize the filename to prevent path traversal
	baseName := filepath.Base(fileName)
	if baseName == "." || baseName == "/" {
		errMsg := "Invalid file name"
		return CompileResponse{HasError: true, CompilerError: &errMsg}
	}

	filePath := filepath.Join(tmpDir, baseName)

	// Write the file content
	if err := os.WriteFile(filePath, []byte(fileContent), 0600); err != nil {
		errMsg := "Failed to write file"
		return CompileResponse{HasError: true, CompilerError: &errMsg}
	}

	ext := strings.ToLower(filepath.Ext(baseName))

	var cmd *exec.Cmd

	switch ext {
	case ".ts":
		// Use tsc to compile TypeScript
		cmd = exec.Command("tsc", "--noEmit", "--strict", filePath)
	case ".cpp", ".cc", ".cxx":
		// Use g++ to compile C++
		outputFile := filepath.Join(tmpDir, "output")
		cmd = exec.Command("g++", "-o", outputFile, filePath)
	case ".c":
		outputFile := filepath.Join(tmpDir, "output")
		cmd = exec.Command("gcc", "-o", outputFile, filePath)
	default:
		errMsg := "Unsupported file type: " + ext
		return CompileResponse{HasError: true, CompilerError: &errMsg}
	}

	var stderr bytes.Buffer
	var stdout bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &stdout

	err = cmd.Run()
	if err != nil {
		// Compilation failed
		errOutput := stderr.String()
		if errOutput == "" {
			errOutput = stdout.String()
		}
		if errOutput == "" {
			errOutput = err.Error()
		}
		return CompileResponse{HasError: true, CompilerError: &errOutput}
	}

	// Compilation succeeded
	return CompileResponse{HasError: false, CompilerError: nil}
}

func main() {
	app := fiber.New()

	app.Post("/compile", func(c *fiber.Ctx) error {
		var req CompileRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		if req.FileName == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "fileName is required",
			})
		}

		if req.FileContent == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "fileContent is required",
			})
		}

		result := compileCode(req.FileName, req.FileContent)
		return c.Status(fiber.StatusOK).JSON(result)
	})

	app.Listen("0.0.0.0:5000")
}