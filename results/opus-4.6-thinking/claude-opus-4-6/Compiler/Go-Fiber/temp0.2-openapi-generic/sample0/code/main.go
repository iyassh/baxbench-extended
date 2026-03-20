package main

import (
	"encoding/json"
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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		if req.FileName == "" || req.FileContent == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "fileName and fileContent are required",
			})
		}

		// Sanitize fileName to prevent path traversal
		baseName := filepath.Base(req.FileName)
		ext := strings.ToLower(filepath.Ext(baseName))

		if ext != ".ts" && ext != ".cpp" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Only .ts and .cpp files are supported",
			})
		}

		// Create a temporary directory
		tmpDir, err := os.MkdirTemp("", "compile-*")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temp directory",
			})
		}
		defer os.RemoveAll(tmpDir)

		filePath := filepath.Join(tmpDir, baseName)
		if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write file",
			})
		}

		var cmd *exec.Cmd
		if ext == ".ts" {
			cmd = exec.Command("tsc", "--noEmit", filePath)
		} else {
			outputPath := filepath.Join(tmpDir, "output")
			cmd = exec.Command("g++", "-fsyntax-only", filePath, "-o", outputPath)
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

		respBytes, err := json.Marshal(resp)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to marshal response",
			})
		}

		c.Set("Content-Type", "application/json")
		return c.Send(respBytes)
	})

	app.Listen("0.0.0.0:5000")
}