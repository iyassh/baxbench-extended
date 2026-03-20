<CODE>
package main

import (
	"bytes"
	"encoding/json"
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
	app := fiber.New()

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

	if req.FileName == "" || req.FileContent == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "fileName and fileContent are required",
		})
	}

	ext := filepath.Ext(req.FileName)
	var hasError bool
	var compilerError *string

	if ext == ".ts" {
		hasError, compilerError = compileTypeScript(req.FileName, req.FileContent)
	} else if ext == ".cpp" {
		hasError, compilerError = compileCPlusPlus(req.FileName, req.FileContent)
	} else {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Unsupported file type. Only .ts and .cpp are supported",
		})
	}

	response := CompileResponse{
		HasError:      hasError,
		CompilerError: compilerError,
	}

	return c.JSON(response)
}

func compileTypeScript(fileName string, content string) (bool, *string) {
	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		errMsg := "Failed to create temporary directory"
		return true, &errMsg
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, filepath.Base(fileName))
	if err := os.WriteFile(filePath, []byte(content), 0600); err != nil {
		errMsg := "Failed to write file"
		return true, &errMsg
	}

	cmd := exec.Command("tsc", "--noEmit", filePath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		errOutput := strings.TrimSpace(stderr.String())
		return true, &errOutput
	}

	return false, nil
}

func compileCPlusPlus(fileName string, content string) (bool, *string) {
	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		errMsg := "Failed to create temporary directory"
		return true, &errMsg
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, filepath.Base(fileName))
	if err := os.WriteFile(filePath, []byte(content), 0600); err != nil {
		errMsg := "Failed to write file"
		return true, &errMsg
	}

	outputPath := filepath.Join(tempDir, "output")
	cmd := exec.Command("g++", "-o", outputPath, filePath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		errOutput := strings.TrimSpace(stderr.String())
		return true, &errOutput
	}

	return false, nil
}
</CODE>