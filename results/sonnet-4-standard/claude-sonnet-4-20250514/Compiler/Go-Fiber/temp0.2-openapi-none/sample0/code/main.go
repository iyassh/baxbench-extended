package main

import (
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
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

	app.Use(cors.New())

	app.Post("/compile", handleCompile)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleCompile(c *fiber.Ctx) error {
	var req CompileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	tempDir := "/tmp/" + uuid.New().String()
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp directory"})
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, req.FileName)
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0644); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to write file"})
	}

	var cmd *exec.Cmd
	var isTypeScript bool

	if strings.HasSuffix(req.FileName, ".ts") {
		isTypeScript = true
		cmd = exec.Command("tsc", "--noEmit", filePath)
	} else if strings.HasSuffix(req.FileName, ".cpp") {
		outputPath := filepath.Join(tempDir, "output")
		cmd = exec.Command("g++", "-o", outputPath, filePath)
	} else {
		return c.Status(400).JSON(fiber.Map{"error": "Unsupported file type"})
	}

	output, err := cmd.CombinedOutput()
	
	response := CompileResponse{
		HasError:      err != nil,
		CompilerError: nil,
	}

	if err != nil {
		errorStr := strings.TrimSpace(string(output))
		if isTypeScript {
			errorStr = strings.ReplaceAll(errorStr, filePath, req.FileName)
		}
		response.CompilerError = &errorStr
	}

	return c.JSON(response)
}