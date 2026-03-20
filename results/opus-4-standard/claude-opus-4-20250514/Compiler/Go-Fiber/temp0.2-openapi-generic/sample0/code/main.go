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
		panic(err)
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

	// Validate file extension
	ext := strings.ToLower(filepath.Ext(req.FileName))
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Only .ts and .cpp files are supported",
		})
	}

	// Create temporary directory
	tempDir := filepath.Join(os.TempDir(), "compile-"+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Write file content to temporary file
	tempFile := filepath.Join(tempDir, filepath.Base(req.FileName))
	if err := os.WriteFile(tempFile, []byte(req.FileContent), 0644); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write temporary file",
		})
	}

	var cmd *exec.Cmd
	if ext == ".ts" {
		// TypeScript compilation
		cmd = exec.Command("tsc", "--noEmit", tempFile)
	} else {
		// C++ compilation
		outputFile := filepath.Join(tempDir, "output")
		cmd = exec.Command("g++", "-o", outputFile, tempFile)
	}

	// Set working directory
	cmd.Dir = tempDir

	// Capture stderr
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create stderr pipe",
		})
	}

	// Start command
	if err := cmd.Start(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to start compiler",
		})
	}

	// Read stderr
	stderrBytes, _ := io.ReadAll(stderr)
	stderrStr := string(stderrBytes)

	// Wait for command to finish
	err = cmd.Wait()

	response := CompileResponse{
		HasError:      err != nil,
		CompilerError: nil,
	}

	if err != nil && stderrStr != "" {
		response.CompilerError = &stderrStr
	}

	return c.JSON(response)
}