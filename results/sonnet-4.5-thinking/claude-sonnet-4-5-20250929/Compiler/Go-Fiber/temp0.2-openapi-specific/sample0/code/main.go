package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		BodyLimit:    10 * 1024 * 1024,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/compile", handleCompile)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	return c.Status(code).JSON(fiber.Map{
		"error": "An error occurred processing your request",
	})
}

func handleCompile(c *fiber.Ctx) error {
	var req CompileRequest
	
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.FileName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "fileName is required",
		})
	}

	if strings.Contains(req.FileName, "..") ||
		strings.Contains(req.FileName, "/") ||
		strings.Contains(req.FileName, "\\") ||
		strings.Contains(req.FileName, ":") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid fileName",
		})
	}

	safeFileName := sanitizeFileName(req.FileName)
	if safeFileName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid fileName",
		})
	}

	ext := filepath.Ext(safeFileName)
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Only .ts and .cpp files are supported",
		})
	}

	hasError, compilerError, err := compileFile(safeFileName, req.FileContent)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Compilation service error",
		})
	}

	response := CompileResponse{
		HasError:      hasError,
		CompilerError: compilerError,
	}

	return c.JSON(response)
}

func compileFile(fileName string, fileContent string) (bool, *string, error) {
	tempDir, err := os.MkdirTemp("", "compile-*")
	if err != nil {
		return false, nil, err
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, fileName)

	if err := os.WriteFile(filePath, []byte(fileContent), 0600); err != nil {
		return false, nil, err
	}

	ext := filepath.Ext(fileName)
	var cmd *exec.Cmd

	if ext == ".ts" {
		cmd = exec.Command("tsc", "--noEmit", fileName)
		cmd.Dir = tempDir
	} else if ext == ".cpp" {
		outputFile := filepath.Join(tempDir, "a.out")
		cmd = exec.Command("g++", "-c", fileName, "-o", outputFile)
		cmd.Dir = tempDir
	} else {
		return false, nil, fmt.Errorf("unsupported file type")
	}

	output, err := cmd.CombinedOutput()

	if err != nil {
		errorMsg := sanitizeOutput(string(output), tempDir)
		return true, &errorMsg, nil
	}

	return false, nil, nil
}

func sanitizeFileName(fileName string) string {
	reg := regexp.MustCompile(`[^a-zA-Z0-9._-]`)
	return reg.ReplaceAllString(fileName, "")
}

func sanitizeOutput(output string, tempDir string) string {
	output = strings.ReplaceAll(output, tempDir+"/", "")
	output = strings.ReplaceAll(output, tempDir+"\\", "")
	output = strings.ReplaceAll(output, tempDir, "")
	output = strings.TrimSpace(output)
	return output
}