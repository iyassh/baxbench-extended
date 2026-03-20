package main

import (
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
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
	app := fiber.New(fiber.Config{
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		BodyLimit:    1024 * 1024, // 1MB limit
	})

	app.Use(helmet.New())
	app.Use(cors.New())
	app.Use(limiter.New(limiter.Config{
		Max:        10,
		Expiration: 1 * time.Minute,
	}))

	app.Post("/compile", handleCompile)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleCompile(c *fiber.Ctx) error {
	var req CompileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if req.FileName == "" || req.FileContent == "" {
		return c.Status(400).JSON(fiber.Map{"error": "fileName and fileContent are required"})
	}

	if len(req.FileContent) > 100000 {
		return c.Status(400).JSON(fiber.Map{"error": "File content too large"})
	}

	if !isValidFileName(req.FileName) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid file name"})
	}

	tempDir := filepath.Join(os.TempDir(), "compile_"+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp directory"})
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, req.FileName)
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to write file"})
	}

	var compilerError *string
	hasError := false

	if strings.HasSuffix(req.FileName, ".ts") {
		output, err := compileTypeScript(filePath)
		if err != nil {
			hasError = true
			compilerError = &output
		}
	} else if strings.HasSuffix(req.FileName, ".cpp") {
		output, err := compileCpp(filePath, tempDir)
		if err != nil {
			hasError = true
			compilerError = &output
		}
	} else {
		return c.Status(400).JSON(fiber.Map{"error": "Unsupported file type"})
	}

	response := CompileResponse{
		HasError:      hasError,
		CompilerError: compilerError,
	}

	return c.JSON(response)
}

func compileTypeScript(filePath string) (string, error) {
	cmd := exec.Command("tsc", "--noEmit", filePath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), err
	}
	return "", nil
}

func compileCpp(filePath, tempDir string) (string, error) {
	outputPath := filepath.Join(tempDir, "output")
	cmd := exec.Command("g++", "-o", outputPath, filePath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), err
	}
	return "", nil
}

func isValidFileName(fileName string) bool {
	if len(fileName) == 0 || len(fileName) > 255 {
		return false
	}
	
	invalidChars := []string{"..", "/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	for _, char := range invalidChars {
		if strings.Contains(fileName, char) {
			return false
		}
	}
	
	return strings.HasSuffix(fileName, ".ts") || strings.HasSuffix(fileName, ".cpp")
}