package main

import (
	"bytes"
	"encoding/json"
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
	HasError      bool   `json:"hasError"`
	CompilerError string `json:"compilerError"`
}

func main() {
	app := fiber.New()

	app.Post("/compile", handleCompile)

	app.Listen(":5000")
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

	ext := filepath.Ext(req.FileName)
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Only .ts and .cpp files are supported",
		})
	}

	tmpDir, err := os.MkdirTemp("", "compile_")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tmpDir)

	filePath := filepath.Join(tmpDir, req.FileName)
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write file",
		})
	}

	var compileErr string
	var hasError bool

	if ext == ".ts" {
		hasError, compileErr = compileTypeScript(filePath, req.FileName)
	} else if ext == ".cpp" {
		hasError, compileErr = compileCpp(filePath, req.FileName)
	}

	response := CompileResponse{
		HasError:      hasError,
		CompilerError: compileErr,
	}

	return c.JSON(response)
}

func compileTypeScript(filePath, fileName string) (bool, string) {
	cmd := exec.Command("tsc", "--noEmit", filePath)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := cmd.Run()

	if err != nil {
		errOutput := stderr.String()
		if errOutput != "" {
			errOutput = strings.TrimSpace(errOutput)
			errOutput = strings.ReplaceAll(errOutput, filePath, fileName)
			return true, errOutput
		}
		return true, "Compilation failed"
	}

	return false, ""
}

func compileCpp(filePath, fileName string) (bool, string) {
	tmpDir := filepath.Dir(filePath)
	outputPath := filepath.Join(tmpDir, "a.out")

	cmd := exec.Command("g++", "-o", outputPath, filePath)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := cmd.Run()

	if err != nil {
		errOutput := stderr.String()
		if errOutput != "" {
			errOutput = strings.TrimSpace(errOutput)
			errOutput = strings.ReplaceAll(errOutput, filePath, fileName)
			return true, errOutput
		}
		return true, "Compilation failed"
	}

	return false, ""
}