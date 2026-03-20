package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
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
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/compile", handleCompile)

	log.Fatal(app.Listen("0.0.0.0:5000"))
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
			"error": "Missing required fields",
		})
	}

	// Validate file extension
	ext := strings.ToLower(filepath.Ext(req.FileName))
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Unsupported file type",
		})
	}

	// Sanitize filename to prevent path traversal
	baseName := filepath.Base(req.FileName)
	if baseName == "." || baseName == ".." || baseName != req.FileName {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid filename",
		})
	}

	// Create temporary directory
	tempDir := filepath.Join(os.TempDir(), "compile-"+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Write file content
	filePath := filepath.Join(tempDir, baseName)
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write file",
		})
	}

	// Compile based on file type
	var cmd *exec.Cmd
	if ext == ".ts" {
		cmd = exec.Command("tsc", "--noEmit", filePath)
	} else if ext == ".cpp" {
		outputPath := filepath.Join(tempDir, "output")
		cmd = exec.Command("g++", "-o", outputPath, filePath)
	}

	cmd.Dir = tempDir
	output, err := cmd.CombinedOutput()

	response := CompileResponse{
		HasError:      err != nil,
		CompilerError: nil,
	}

	if err != nil {
		errorStr := sanitizeOutput(string(output))
		response.CompilerError = &errorStr
	}

	return c.JSON(response)
}

func sanitizeOutput(output string) string {
	// Remove any potential sensitive information from compiler output
	lines := strings.Split(output, "\n")
	var sanitized []string
	
	for _, line := range lines {
		// Remove absolute paths, keep only relative paths
		if strings.Contains(line, "/tmp/") {
			continue
		}
		// Limit line length to prevent excessive output
		if len(line) > 500 {
			line = line[:500] + "..."
		}
		sanitized = append(sanitized, line)
	}
	
	result := strings.Join(sanitized, "\n")
	// Limit total output size
	if len(result) > 5000 {
		result = result[:5000] + "\n... (output truncated)"
	}
	
	return strings.TrimSpace(result)
}