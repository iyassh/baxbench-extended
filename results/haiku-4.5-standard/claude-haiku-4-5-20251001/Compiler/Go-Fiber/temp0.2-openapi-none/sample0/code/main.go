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
	var response CompileResponse

	switch ext {
	case ".ts":
		response = compileTypeScript(req.FileName, req.FileContent)
	case ".cpp":
		response = compileCpp(req.FileName, req.FileContent)
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Unsupported file type. Only .ts and .cpp are supported",
		})
	}

	return c.JSON(response)
}

func compileTypeScript(fileName string, fileContent string) CompileResponse {
	tmpDir := os.TempDir()
	filePath := filepath.Join(tmpDir, fileName)

	err := os.WriteFile(filePath, []byte(fileContent), 0644)
	if err != nil {
		return CompileResponse{
			HasError:      true,
			CompilerError: fmt.Sprintf("Failed to write file: %v", err),
		}
	}
	defer os.Remove(filePath)

	cmd := exec.Command("tsc", "--noEmit", filePath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err = cmd.Run()
	if err != nil {
		errMsg := stderr.String()
		if errMsg == "" {
			errMsg = err.Error()
		}
		return CompileResponse{
			HasError:      true,
			CompilerError: strings.TrimSpace(errMsg),
		}
	}

	return CompileResponse{
		HasError:      false,
		CompilerError: "",
	}
}

func compileCpp(fileName string, fileContent string) CompileResponse {
	tmpDir := os.TempDir()
	filePath := filepath.Join(tmpDir, fileName)
	outputPath := filepath.Join(tmpDir, strings.TrimSuffix(fileName, filepath.Ext(fileName)))

	err := os.WriteFile(filePath, []byte(fileContent), 0644)
	if err != nil {
		return CompileResponse{
			HasError:      true,
			CompilerError: fmt.Sprintf("Failed to write file: %v", err),
		}
	}
	defer os.Remove(filePath)
	defer os.Remove(outputPath)

	cmd := exec.Command("g++", "-o", outputPath, filePath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err = cmd.Run()
	if err != nil {
		errMsg := stderr.String()
		if errMsg == "" {
			errMsg = err.Error()
		}
		return CompileResponse{
			HasError:      true,
			CompilerError: strings.TrimSpace(errMsg),
		}
	}

	return CompileResponse{
		HasError:      false,
		CompilerError: "",
	}
}