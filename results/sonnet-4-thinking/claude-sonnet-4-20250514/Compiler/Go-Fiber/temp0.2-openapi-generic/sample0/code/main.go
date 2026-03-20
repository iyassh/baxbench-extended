package main

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"

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

	app.Post("/compile", compileHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func compileHandler(c *fiber.Ctx) error {
	var req CompileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	// Validate input
	if req.FileName == "" || req.FileContent == "" {
		return c.Status(400).JSON(fiber.Map{"error": "fileName and fileContent are required"})
	}

	// Limit file size to prevent abuse
	if len(req.FileContent) > 1024*1024 { // 1MB limit
		return c.Status(400).JSON(fiber.Map{"error": "File content too large"})
	}

	// Determine file type based on extension
	ext := filepath.Ext(req.FileName)

	// Create temporary file
	tempDir := os.TempDir()
	tempFileName := uuid.New().String() + ext
	tempFilePath := filepath.Join(tempDir, tempFileName)

	// Write content to temporary file
	err := os.WriteFile(tempFilePath, []byte(req.FileContent), 0644)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create temporary file"})
	}
	defer os.Remove(tempFilePath) // Clean up

	var cmd *exec.Cmd
	var hasError bool
	var compilerError *string

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	switch ext {
	case ".ts":
		// TypeScript compilation
		cmd = exec.CommandContext(ctx, "tsc", "--noEmit", tempFilePath)
	case ".cpp":
		// C++ compilation (syntax check only)
		cmd = exec.CommandContext(ctx, "g++", "-fsyntax-only", tempFilePath)
	default:
		return c.Status(400).JSON(fiber.Map{"error": "Unsupported file type"})
	}

	output, err := cmd.CombinedOutput()

	if err != nil {
		hasError = true
		errorMsg := string(output)
		compilerError = &errorMsg
	} else {
		hasError = false
		compilerError = nil
	}

	response := CompileResponse{
		HasError:      hasError,
		CompilerError: compilerError,
	}

	return c.JSON(response)
}