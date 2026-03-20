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

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Printf("Error starting server: %v\n", err)
		os.Exit(1)
	}
}

func handleCompile(c *fiber.Ctx) error {
	var req CompileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Create a temporary directory for compilation
	tempDir, err := os.MkdirTemp("", "compile-*")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Write the file content to temporary file
	tempFilePath := filepath.Join(tempDir, req.FileName)
	if err := os.WriteFile(tempFilePath, []byte(req.FileContent), 0644); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write temporary file",
		})
	}

	// Determine file extension and compile accordingly
	ext := filepath.Ext(req.FileName)
	var compilerOutput string
	var compileErr error

	switch ext {
	case ".ts":
		// Compile TypeScript
		cmd := exec.Command("tsc", "--noEmit", tempFilePath)
		output, err := cmd.CombinedOutput()
		compilerOutput = string(output)
		compileErr = err

	case ".cpp", ".cc", ".cxx", ".c++":
		// Compile C++
		outputPath := filepath.Join(tempDir, "output")
		cmd := exec.Command("g++", "-o", outputPath, tempFilePath)
		output, err := cmd.CombinedOutput()
		compilerOutput = string(output)
		compileErr = err

	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Unsupported file type. Only .ts and .cpp files are supported",
		})
	}

	// Prepare response
	response := CompileResponse{
		HasError:      compileErr != nil,
		CompilerError: nil,
	}

	if compileErr != nil {
		// Clean up the output to remove absolute paths
		compilerOutput = strings.ReplaceAll(compilerOutput, tempFilePath, req.FileName)
		compilerOutput = strings.TrimSpace(compilerOutput)
		if compilerOutput != "" {
			response.CompilerError = &compilerOutput
		}
	}

	return c.JSON(response)
}