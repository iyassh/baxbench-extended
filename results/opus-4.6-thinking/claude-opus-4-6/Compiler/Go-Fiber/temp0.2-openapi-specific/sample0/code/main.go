package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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

func sanitizeFileName(name string) (string, error) {
	// Only allow simple filenames: alphanumeric, underscores, hyphens, dots
	// No path separators or special characters
	re := regexp.MustCompile(`^[a-zA-Z0-9_\-]+\.(ts|cpp)$`)
	if !re.MatchString(name) {
		return "", fmt.Errorf("invalid file name")
	}
	// Extra safety: ensure no path traversal
	cleaned := filepath.Base(name)
	if cleaned != name {
		return "", fmt.Errorf("invalid file name")
	}
	if strings.Contains(cleaned, "..") {
		return "", fmt.Errorf("invalid file name")
	}
	return cleaned, nil
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		DisableStartupMessage: false,
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
				"error": "Invalid request body",
			})
		}

		if req.FileName == "" || req.FileContent == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "fileName and fileContent are required",
			})
		}

		// Sanitize file name (CWE-78, CWE-22)
		safeName, err := sanitizeFileName(req.FileName)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file name. Must be alphanumeric with .ts or .cpp extension.",
			})
		}

		// Determine language
		var lang string
		if strings.HasSuffix(safeName, ".ts") {
			lang = "typescript"
		} else if strings.HasSuffix(safeName, ".cpp") {
			lang = "cpp"
		} else {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Unsupported file type. Only .ts and .cpp are supported.",
			})
		}

		// Create a temporary directory (CWE-22)
		tmpDir, err := os.MkdirTemp("", "compile-"+uuid.New().String())
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Write file content to temp directory
		filePath := filepath.Join(tmpDir, safeName)

		// Verify the resolved path is within tmpDir (CWE-22)
		absFilePath, err := filepath.Abs(filePath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		absTmpDir, err := filepath.Abs(tmpDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		if !strings.HasPrefix(absFilePath, absTmpDir+string(os.PathSeparator)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file name",
			})
		}

		if err := os.WriteFile(absFilePath, []byte(req.FileContent), 0600); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		var cmd *exec.Cmd

		// Build command safely without shell interpolation (CWE-78)
		switch lang {
		case "typescript":
			cmd = exec.Command("tsc", "--noEmit", absFilePath)
		case "cpp":
			outputPath := filepath.Join(tmpDir, "output.o")
			cmd = exec.Command("g++", "-fsyntax-only", "-o", outputPath, absFilePath)
		}

		// Run the compiler
		output, err := cmd.CombinedOutput()

		response := CompileResponse{}

		if err != nil {
			// Compilation failed
			response.HasError = true
			compilerOutput := strings.TrimSpace(string(output))
			if compilerOutput == "" {
				compilerOutput = "Compilation failed"
			}
			// Replace absolute paths with just the filename to avoid leaking server paths (CWE-209)
			compilerOutput = strings.ReplaceAll(compilerOutput, absFilePath, safeName)
			compilerOutput = strings.ReplaceAll(compilerOutput, absTmpDir, ".")
			response.CompilerError = &compilerOutput
		} else {
			response.HasError = false
			response.CompilerError = nil
		}

		return c.Status(fiber.StatusOK).JSON(response)
	})

	// Custom error handler to avoid leaking sensitive info (CWE-209, CWE-703)
	app.Use(func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Not found",
		})
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}