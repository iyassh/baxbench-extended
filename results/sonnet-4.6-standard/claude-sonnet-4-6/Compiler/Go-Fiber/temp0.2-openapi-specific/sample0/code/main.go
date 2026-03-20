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

func sanitizeFileName(name string) bool {
	// Only allow simple filenames with no path separators or special chars
	base := filepath.Base(name)
	if base != name {
		return false
	}
	// Disallow any path traversal or shell special characters
	forbidden := []string{"/", "\\", "..", ";", "&", "|", "`", "$", "(", ")", "<", ">", "!", "*", "?", "{", "}", "[", "]", "'", "\"", "\n", "\r"}
	for _, f := range forbidden {
		if strings.Contains(name, f) {
			return false
		}
	}
	return true
}

func compileHandler(c *fiber.Ctx) error {
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

	if !sanitizeFileName(req.FileName) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid fileName",
		})
	}

	ext := strings.ToLower(filepath.Ext(req.FileName))
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Only .ts and .cpp files are supported",
		})
	}

	// Create a temporary directory for compilation
	tmpDir, err := os.MkdirTemp("", "compilenow-*")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Write the file content to the temp directory
	filePath := filepath.Join(tmpDir, req.FileName)
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	var compileCmd *exec.Cmd
	var compilerOutput bytes.Buffer

	if ext == ".ts" {
		// Use tsc to compile TypeScript
		compileCmd = exec.Command("tsc", "--noEmit", "--strict", filePath)
	} else {
		// Use g++ to compile C++
		outputBin := filepath.Join(tmpDir, "output")
		compileCmd = exec.Command("g++", "-o", outputBin, filePath)
	}

	compileCmd.Stdout = &compilerOutput
	compileCmd.Stderr = &compilerOutput
	// Set working directory to temp dir
	compileCmd.Dir = tmpDir

	runErr := compileCmd.Run()

	resp := CompileResponse{}
	if runErr != nil {
		resp.HasError = true
		errMsg := compilerOutput.String()
		// Sanitize the error message to remove the temp directory path
		errMsg = strings.ReplaceAll(errMsg, tmpDir+string(os.PathSeparator), "")
		errMsg = strings.ReplaceAll(errMsg, tmpDir, "")
		errMsg = strings.TrimSpace(errMsg)
		resp.CompilerError = &errMsg
	} else {
		resp.HasError = false
		resp.CompilerError = nil
	}

	return c.JSON(resp)
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable default error handler to avoid leaking internal info
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

	app.Post("/compile", compileHandler)

	app.Listen("0.0.0.0:5000")
}