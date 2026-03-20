package main

import (
	"bytes"
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

func isValidExtension(fileName string) bool {
	ext := strings.ToLower(filepath.Ext(fileName))
	return ext == ".ts" || ext == ".cpp"
}

func isValidFileName(fileName string) bool {
	// Ensure no path separators or special characters
	base := filepath.Base(fileName)
	if base != fileName {
		return false
	}
	// Disallow hidden files and other suspicious names
	if strings.HasPrefix(fileName, ".") {
		return false
	}
	// Only allow alphanumeric, underscore, hyphen, dot
	for _, c := range fileName {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.') {
			return false
		}
	}
	return true
}

func compileFile(fileName, fileContent string) CompileResponse {
	// Create a temporary directory
	tmpDir, err := os.MkdirTemp("", "compilenow-*")
	if err != nil {
		errMsg := "Failed to create temporary directory"
		return CompileResponse{HasError: true, CompilerError: &errMsg}
	}
	defer os.RemoveAll(tmpDir)

	// Write file content to the temp directory
	filePath := filepath.Join(tmpDir, fileName)
	err = os.WriteFile(filePath, []byte(fileContent), 0600)
	if err != nil {
		errMsg := "Failed to write source file"
		return CompileResponse{HasError: true, CompilerError: &errMsg}
	}

	ext := strings.ToLower(filepath.Ext(fileName))

	var cmd *exec.Cmd
	var stderr bytes.Buffer

	if ext == ".ts" {
		// Use tsc to compile TypeScript
		cmd = exec.Command("tsc", "--noEmit", "--strict", filePath)
	} else if ext == ".cpp" {
		outputBin := filepath.Join(tmpDir, "output")
		cmd = exec.Command("g++", "-o", outputBin, filePath)
	} else {
		errMsg := "Unsupported file type"
		return CompileResponse{HasError: true, CompilerError: &errMsg}
	}

	cmd.Stderr = &stderr
	cmd.Stdout = &stderr

	runErr := cmd.Run()

	if runErr != nil {
		errOutput := stderr.String()
		// Sanitize the error output to remove the temp directory path
		errOutput = strings.ReplaceAll(errOutput, tmpDir+string(os.PathSeparator), "")
		errOutput = strings.ReplaceAll(errOutput, tmpDir, "")
		errOutput = strings.TrimSpace(errOutput)
		return CompileResponse{HasError: true, CompilerError: &errOutput}
	}

	return CompileResponse{HasError: false, CompilerError: nil}
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable default error handler to avoid leaking sensitive info
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/compile", func(c *fiber.Ctx) error {
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

		if !isValidFileName(req.FileName) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file name",
			})
		}

		if !isValidExtension(req.FileName) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Unsupported file type. Only .ts and .cpp are supported",
			})
		}

		// Limit file content size to prevent abuse
		if len(req.FileContent) > 1024*1024 { // 1MB limit
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File content too large",
			})
		}

		result := compileFile(req.FileName, req.FileContent)
		return c.Status(fiber.StatusOK).JSON(result)
	})

	app.Listen("0.0.0.0:5000")
}