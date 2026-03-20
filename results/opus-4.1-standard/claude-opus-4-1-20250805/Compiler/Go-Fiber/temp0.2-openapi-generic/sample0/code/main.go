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
	"github.com/google/uuid"
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

	// Validate input
	if req.FileName == "" || req.FileContent == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "fileName and fileContent are required",
		})
	}

	// Check file extension
	ext := strings.ToLower(filepath.Ext(req.FileName))
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Only .ts and .cpp files are supported",
		})
	}

	// Create temporary directory for compilation
	tempDir := filepath.Join(os.TempDir(), "compile-"+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Write file content to temporary file
	tempFile := filepath.Join(tempDir, filepath.Base(req.FileName))
	if err := os.WriteFile(tempFile, []byte(req.FileContent), 0600); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write temporary file",
		})
	}

	var cmd *exec.Cmd
	if ext == ".ts" {
		// TypeScript compilation
		cmd = exec.Command("tsc", "--noEmit", tempFile)
	} else if ext == ".cpp" {
		// C++ compilation
		outputFile := filepath.Join(tempDir, "output")
		cmd = exec.Command("g++", "-o", outputFile, tempFile)
	}

	cmd.Dir = tempDir
	output, err := cmd.CombinedOutput()

	response := CompileResponse{
		HasError:      err != nil,
		CompilerError: nil,
	}

	if err != nil {
		errorStr := string(output)
		if errorStr == "" {
			errorStr = err.Error()
		}
		response.CompilerError = &errorStr
	}

	return c.JSON(response)
}