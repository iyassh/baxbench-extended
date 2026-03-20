package main

import (
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

		// Determine language from file extension
		ext := strings.ToLower(filepath.Ext(req.FileName))

		// Create a temp directory
		tmpDir, err := os.MkdirTemp("", "compile-*")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temp directory",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Write the file
		filePath := filepath.Join(tmpDir, req.FileName)
		if err := os.WriteFile(filePath, []byte(req.FileContent), 0644); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write file",
			})
		}

		var compileErr *string

		switch ext {
		case ".ts":
			// Compile TypeScript
			cmd := exec.Command("tsc", "--noEmit", "--strict", filePath)
			output, err := cmd.CombinedOutput()
			if err != nil {
				errStr := strings.TrimSpace(string(output))
				compileErr = &errStr
			}
		case ".cpp", ".cc", ".cxx":
			// Compile C++
			outputBin := filepath.Join(tmpDir, "output")
			cmd := exec.Command("g++", filePath, "-o", outputBin)
			output, err := cmd.CombinedOutput()
			if err != nil {
				errStr := strings.TrimSpace(string(output))
				compileErr = &errStr
			}
		default:
			errStr := "Unsupported file type: " + ext
			compileErr = &errStr
		}

		resp := CompileResponse{
			HasError:      compileErr != nil,
			CompilerError: compileErr,
		}

		return c.JSON(resp)
	})

	app.Listen("0.0.0.0:5000")
}