package main

import (
	"os"
	"os/exec"
	"path/filepath"

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

	app.Listen("0.0.0.0:5000")
}

func handleCompile(c *fiber.Ctx) error {
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

	if filepath.Base(req.FileName) != req.FileName {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "fileName must be a simple filename without path separators",
		})
	}

	ext := filepath.Ext(req.FileName)
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Only .ts and .cpp files are supported",
		})
	}

	tempDir, err := os.MkdirTemp("", "compile-*")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, req.FileName)
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write file",
		})
	}

	var compilerError string
	var hasError bool

	if ext == ".ts" {
		cmd := exec.Command("tsc", "--noEmit", req.FileName)
		cmd.Dir = tempDir
		output, err := cmd.CombinedOutput()
		if err != nil {
			hasError = true
			compilerError = string(output)
		}
	} else if ext == ".cpp" {
		outputFile := "output-" + uuid.New().String()
		cmd := exec.Command("g++", "-c", req.FileName, "-o", outputFile)
		cmd.Dir = tempDir
		output, err := cmd.CombinedOutput()
		if err != nil {
			hasError = true
			compilerError = string(output)
		}
	}

	response := CompileResponse{
		HasError: hasError,
	}

	if hasError {
		response.CompilerError = &compilerError
	}

	return c.JSON(response)
}