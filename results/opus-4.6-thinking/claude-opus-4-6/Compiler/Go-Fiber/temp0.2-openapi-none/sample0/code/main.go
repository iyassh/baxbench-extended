package main

import (
	"fmt"
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
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		ext := strings.ToLower(filepath.Ext(req.FileName))

		tmpDir, err := os.MkdirTemp("", "compile-*")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp directory"})
		}
		defer os.RemoveAll(tmpDir)

		filePath := filepath.Join(tmpDir, req.FileName)
		if err := os.WriteFile(filePath, []byte(req.FileContent), 0644); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to write file"})
		}

		var cmd *exec.Cmd

		switch ext {
		case ".ts":
			cmd = exec.Command("tsc", "--noEmit", filePath)
		case ".cpp", ".cc", ".cxx":
			outputPath := filepath.Join(tmpDir, "output")
			cmd = exec.Command("g++", "-o", outputPath, "-fsyntax-only", filePath)
		default:
			return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("Unsupported file extension: %s", ext)})
		}

		output, err := cmd.CombinedOutput()

		resp := CompileResponse{}

		if err != nil {
			resp.HasError = true
			errStr := strings.TrimSpace(string(output))
			if errStr == "" {
				errStr = err.Error()
			}
			resp.CompilerError = &errStr
		} else {
			resp.HasError = false
			resp.CompilerError = nil
		}

		return c.JSON(resp)
	})

	app.Listen("0.0.0.0:5000")
}