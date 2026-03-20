package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type CompileRequest struct {
	FileName    string `json:"fileName"`
	FileContent string `json:"fileContent"`
}

type CompileResponse struct {
	HasError      bool   `json:"hasError"`
	CompilerError string `json:"compilerError"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"hasError":      true,
				"compilerError": "Internal server error",
			})
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'; script-src 'none'; style-src 'none'")
		return c.Next()
	})

	app.Post("/compile", handleCompile)

	app.Listen(":5000")
}

func handleCompile(c *fiber.Ctx) error {
	var req CompileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(CompileResponse{
			HasError:      true,
			CompilerError: "Invalid request format",
		})
	}

	if err := validateInput(req.FileName, req.FileContent); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(CompileResponse{
			HasError:      true,
			CompilerError: "Invalid input",
		})
	}

	ext := filepath.Ext(req.FileName)
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(CompileResponse{
			HasError:      true,
			CompilerError: "Unsupported file type",
		})
	}

	tmpDir, err := os.MkdirTemp("", "compile_")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(CompileResponse{
			HasError:      true,
			CompilerError: "Internal server error",
		})
	}
	defer os.RemoveAll(tmpDir)

	filePath := filepath.Join(tmpDir, filepath.Base(req.FileName))
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(CompileResponse{
			HasError:      true,
			CompilerError: "Internal server error",
		})
	}

	var result CompileResponse

	if ext == ".ts" {
		result = compileTypeScript(filePath, req.FileName)
	} else if ext == ".cpp" {
		result = compileCpp(filePath, req.FileName)
	}

	statusCode := fiber.StatusOK
	if result.HasError {
		statusCode = fiber.StatusOK
	}

	return c.Status(statusCode).JSON(result)
}

func validateInput(fileName, fileContent string) error {
	if fileName == "" || fileContent == "" {
		return fmt.Errorf("empty input")
	}

	if len(fileName) > 255 || len(fileContent) > 1000000 {
		return fmt.Errorf("input too large")
	}

	if strings.Contains(fileName, "/") || strings.Contains(fileName, "\\") || strings.Contains(fileName, "..") {
		return fmt.Errorf("invalid filename")
	}

	return nil
}

func compileTypeScript(filePath, originalFileName string) CompileResponse {
	cmd := exec.Command("npx", "tsc", "--noEmit", filePath)
	cmd.Dir = filepath.Dir(filePath)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := cmd.Run()

	if err != nil {
		errOutput := stderr.String()
		if errOutput == "" {
			errOutput = "Compilation failed"
		}
		return CompileResponse{
			HasError:      true,
			CompilerError: sanitizeErrorOutput(errOutput, originalFileName),
		}
	}

	return CompileResponse{
		HasError:      false,
		CompilerError: "",
	}
}

func compileCpp(filePath, originalFileName string) CompileResponse {
	outputPath := strings.TrimSuffix(filePath, filepath.Ext(filePath))

	cmd := exec.Command("g++", "-o", outputPath, filePath)
	cmd.Dir = filepath.Dir(filePath)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := cmd.Run()

	if err != nil {
		errOutput := stderr.String()
		if errOutput == "" {
			errOutput = "Compilation failed"
		}
		return CompileResponse{
			HasError:      true,
			CompilerError: sanitizeErrorOutput(errOutput, originalFileName),
		}
	}

	return CompileResponse{
		HasError:      false,
		CompilerError: "",
	}
}

func sanitizeErrorOutput(errOutput, originalFileName string) string {
	lines := strings.Split(errOutput, "\n")
	var sanitized []string

	for _, line := range lines {
		if line == "" {
			continue
		}

		line = strings.ReplaceAll(line, "/tmp/", "")
		line = strings.ReplaceAll(line, "compile_", "")

		parts := strings.Split(line, ":")
		if len(parts) > 0 {
			parts[0] = originalFileName
			line = strings.Join(parts, ":")
		}

		sanitized = append(sanitized, line)
	}

	result := strings.Join(sanitized, "\n")
	result = strings.TrimSpace(result)

	if len(result) > 500 {
		result = result[:500]
	}

	return result
}