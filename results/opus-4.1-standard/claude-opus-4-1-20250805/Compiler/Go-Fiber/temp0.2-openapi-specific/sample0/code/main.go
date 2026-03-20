package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
		BodyLimit: 1 * 1024 * 1024, // 1MB limit
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Custom security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

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

	// Validate input
	if req.FileName == "" || req.FileContent == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "fileName and fileContent are required",
		})
	}

	// Validate filename - prevent path traversal
	if !isValidFileName(req.FileName) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file name",
		})
	}

	// Limit file content size
	if len(req.FileContent) > 100000 { // 100KB limit
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File content too large",
		})
	}

	// Determine file type
	ext := strings.ToLower(filepath.Ext(req.FileName))
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Only .ts and .cpp files are supported",
		})
	}

	// Create temporary directory
	tempDir := filepath.Join(os.TempDir(), "compile-"+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		log.Printf("Failed to create temp directory: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer os.RemoveAll(tempDir)

	// Write file to temp directory
	safeFileName := filepath.Base(req.FileName)
	filePath := filepath.Join(tempDir, safeFileName)
	if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
		log.Printf("Failed to write file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Compile based on file type
	var compilerOutput string
	var compileErr error

	if ext == ".ts" {
		compilerOutput, compileErr = compileTypeScript(filePath, tempDir)
	} else {
		compilerOutput, compileErr = compileCpp(filePath, tempDir)
	}

	// Prepare response
	response := CompileResponse{
		HasError:      compileErr != nil,
		CompilerError: nil,
	}

	if compileErr != nil {
		// Sanitize compiler output
		sanitized := sanitizeCompilerOutput(compilerOutput, tempDir)
		response.CompilerError = &sanitized
	}

	return c.JSON(response)
}

func isValidFileName(fileName string) bool {
	// Check for path traversal attempts
	if strings.Contains(fileName, "..") || strings.Contains(fileName, "/") || strings.Contains(fileName, "\\") {
		return false
	}

	// Only allow alphanumeric, dash, underscore, and dot
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9_\-\.]+$`, fileName)
	if !matched {
		return false
	}

	// Must have valid extension
	ext := strings.ToLower(filepath.Ext(fileName))
	if ext != ".ts" && ext != ".cpp" {
		return false
	}

	// Reasonable length limit
	if len(fileName) > 100 {
		return false
	}

	return true
}

func compileTypeScript(filePath, tempDir string) (string, error) {
	cmd := exec.Command("tsc", "--noEmit", "--strict", filepath.Base(filePath))
	cmd.Dir = tempDir
	
	// Limit resources
	cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin"}
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), err
	}
	return "", nil
}

func compileCpp(filePath, tempDir string) (string, error) {
	outputPath := filepath.Join(tempDir, "output")
	cmd := exec.Command("g++", "-Wall", "-Werror", "-o", outputPath, filepath.Base(filePath))
	cmd.Dir = tempDir
	
	// Limit resources
	cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin"}
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), err
	}
	return "", nil
}

func sanitizeCompilerOutput(output, tempDir string) string {
	// Remove sensitive path information
	sanitized := strings.ReplaceAll(output, tempDir+"/", "")
	sanitized = strings.ReplaceAll(sanitized, tempDir, "")
	
	// Remove any remaining absolute paths
	pathRegex := regexp.MustCompile(`(/[^\s:]+)+`)
	sanitized = pathRegex.ReplaceAllStringFunc(sanitized, func(match string) string {
		if strings.Contains(match, ".ts") || strings.Contains(match, ".cpp") {
			return filepath.Base(match)
		}
		return ""
	})
	
	// Limit output size
	maxLen := 5000
	if len(sanitized) > maxLen {
		sanitized = sanitized[:maxLen] + "... (truncated)"
	}
	
	return strings.TrimSpace(sanitized)
}