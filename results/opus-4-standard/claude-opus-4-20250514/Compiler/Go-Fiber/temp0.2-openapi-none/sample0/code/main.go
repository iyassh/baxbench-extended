package main

import (
	"encoding/json"
	"fmt"
	"io"
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

	app.Post("/compile", handleCompile)

	app.Listen("0.0.0.0:5000")
}

func handleCompile(c *fiber.Ctx) error {
	var req CompileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", "compile-")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp directory"})
	}
	defer os.RemoveAll(tempDir)

	// Write file content to temporary file
	filePath := filepath.Join(tempDir, req.FileName)
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0644); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to write file"})
	}

	// Determine file type and compile
	ext := filepath.Ext(req.FileName)
	var cmd *exec.Cmd
	var compilerError string

	switch ext {
	case ".ts":
		// TypeScript compilation
		cmd = exec.Command("tsc", "--noEmit", filePath)
	case ".cpp":
		// C++ compilation
		outputPath := filepath.Join(tempDir, "output")
		cmd = exec.Command("g++", "-o", outputPath, filePath)
	default:
		errorMsg := "Unsupported file type. Only .ts and .cpp files are supported"
		return c.JSON(CompileResponse{
			HasError:      true,
			CompilerError: &errorMsg,
		})
	}

	// Run the compiler
	cmd.Dir = tempDir
	output, err := cmd.CombinedOutput()

	response := CompileResponse{
		HasError:      err != nil,
		CompilerError: nil,
	}

	if err != nil {
		compilerError = strings.TrimSpace(string(output))
		response.CompilerError = &compilerError
	}

	return c.JSON(response)
}