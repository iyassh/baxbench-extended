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

	app.Post("/compile", handleCompile)

	app.Listen("0.0.0.0:5000")
}

func handleCompile(c *fiber.Ctx) error {
	var req CompileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	tmpDir, err := os.MkdirTemp("", "compile-*")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tmpDir)

	filePath := filepath.Join(tmpDir, req.FileName)
	err = os.WriteFile(filePath, []byte(req.FileContent), 0644)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to write file",
		})
	}

	var compilerOutput string
	var compileErr error

	if strings.HasSuffix(req.FileName, ".ts") {
		cmd := exec.Command("tsc", req.FileName, "--noEmit")
		cmd.Dir = tmpDir
		output, err := cmd.CombinedOutput()
		compilerOutput = string(output)
		compileErr = err
	} else if strings.HasSuffix(req.FileName, ".cpp") {
		cmd := exec.Command("g++", req.FileName, "-o", "output")
		cmd.Dir = tmpDir
		output, err := cmd.CombinedOutput()
		compilerOutput = string(output)
		compileErr = err
	} else {
		return c.Status(400).JSON(fiber.Map{
			"error": "Unsupported file type. Only .ts and .cpp files are supported",
		})
	}

	response := CompileResponse{
		HasError:      compileErr != nil,
		CompilerError: nil,
	}

	if compileErr != nil {
		trimmedOutput := strings.TrimSpace(compilerOutput)
		response.CompilerError = &trimmedOutput
	}

	return c.JSON(response)
}