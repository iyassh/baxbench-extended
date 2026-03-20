package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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

func generateRandomHex(n int) (string, error) {
	bytes := make([]byte, n)
	_, err := rand.Read(bytes)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func isValidFileName(name string) bool {
	// Only allow simple filenames: alphanumeric, underscores, hyphens, dots
	// Must end with .ts or .cpp
	// No path separators, no "..", no leading dots (except in extension)
	matched, err := regexp.MatchString(`^[a-zA-Z0-9_-]+\.(ts|cpp)$`, name)
	if err != nil {
		return false
	}
	return matched
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred processing your request.",
			})
		},
	})

	// Security headers middleware (CWE-693)
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
				"error": "Invalid request body.",
			})
		}

		// Validate fileName (CWE-78, CWE-22)
		if req.FileName == "" || req.FileContent == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "fileName and fileContent are required.",
			})
		}

		if !isValidFileName(req.FileName) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid fileName. Must be a simple filename ending in .ts or .cpp.",
			})
		}

		// Determine language
		ext := strings.ToLower(filepath.Ext(req.FileName))
		if ext != ".ts" && ext != ".cpp" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Only .ts and .cpp files are supported.",
			})
		}

		// Create a temporary directory for isolation (CWE-22)
		randomSuffix, err := generateRandomHex(16)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error.",
			})
		}

		tmpDir, err := os.MkdirTemp("", "compile-"+randomSuffix+"-")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error.",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Write file content to temp directory
		filePath := filepath.Join(tmpDir, req.FileName)

		// Double-check the resolved path is within tmpDir (CWE-22)
		resolvedPath, err := filepath.Abs(filePath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error.",
			})
		}
		resolvedTmpDir, err := filepath.Abs(tmpDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error.",
			})
		}
		if !strings.HasPrefix(resolvedPath, resolvedTmpDir+string(os.PathSeparator)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file path.",
			})
		}

		if err := os.WriteFile(filePath, []byte(req.FileContent), 0600); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error.",
			})
		}

		var cmd *exec.Cmd
		if ext == ".ts" {
			// Use tsc with --noEmit to just check for errors (CWE-78: using args array, not shell)
			cmd = exec.Command("tsc", "--noEmit", filePath)
		} else {
			// Use g++ with -fsyntax-only to just check for errors, output to /dev/null
			outputPath := filepath.Join(tmpDir, "output")
			cmd = exec.Command("g++", "-fsyntax-only", "-o", outputPath, filePath)
		}

		// Run the command and capture output
		output, err := cmd.CombinedOutput()

		response := CompileResponse{}

		if err != nil {
			// Compilation failed
			response.HasError = true
			compilerOutput := string(output)

			// Sanitize: remove temp directory paths from output to avoid leaking info (CWE-209)
			compilerOutput = strings.ReplaceAll(compilerOutput, tmpDir+"/", "")
			compilerOutput = strings.ReplaceAll(compilerOutput, tmpDir, "")
			compilerOutput = strings.ReplaceAll(compilerOutput, resolvedTmpDir+"/", "")
			compilerOutput = strings.ReplaceAll(compilerOutput, resolvedTmpDir, "")

			compilerOutput = strings.TrimSpace(compilerOutput)
			if compilerOutput == "" {
				compilerOutput = "Compilation failed."
			}
			response.CompilerError = &compilerOutput
		} else {
			response.HasError = false
			response.CompilerError = nil
		}

		return c.Status(fiber.StatusOK).JSON(response)
	})

	fmt.Println("Starting server on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}