package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
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
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
		BodyLimit: 1024 * 1024, // 1MB limit
	})

	app.Use(recover.New())
	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	if req.FileName == "" || req.FileContent == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "fileName and fileContent are required",
		})
	}

	if len(req.FileContent) > 100000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File content too large",
		})
	}

	if !isValidFileName(req.FileName) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file name",
		})
	}

	ext := strings.ToLower(filepath.Ext(req.FileName))
	if ext != ".ts" && ext != ".cpp" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Only .ts and .cpp files are supported",
		})
	}

	response, err := compileCode(req.FileName, req.FileContent)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Compilation service unavailable",
		})
	}

	return c.JSON(response)
}

func isValidFileName(fileName string) bool {
	if len(fileName) == 0 || len(fileName) > 100 {
		return false
	}
	
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9._-]+\.(ts|cpp)$`, fileName)
	return matched && !strings.Contains(fileName, "..") && !strings.Contains(fileName, "/") && !strings.Contains(fileName, "\\")
}

func compileCode(fileName, content string) (*CompileResponse, error) {
	tempDir := "/tmp"
	uniqueID := uuid.New().String()
	safeDir := filepath.Join(tempDir, "compile_"+uniqueID)
	
	if err := os.MkdirAll(safeDir, 0700); err != nil {
		return nil, err
	}
	defer os.RemoveAll(safeDir)

	ext := strings.ToLower(filepath.Ext(fileName))
	safeName := regexp.MustCompile(`[^a-zA-Z0-9._-]`).ReplaceAllString(fileName, "_")
	filePath := filepath.Join(safeDir, safeName)

	if err := os.WriteFile(filePath, []byte(content), 0600); err != nil {
		return nil, err
	}

	var cmd *exec.Cmd
	switch ext {
	case ".ts":
		cmd = exec.Command("tsc", "--noEmit", filePath)
	case ".cpp":
		outputPath := filepath.Join(safeDir, "output")
		cmd = exec.Command("g++", "-fsyntax-only", filePath, "-o", outputPath)
	default:
		return &CompileResponse{
			HasError:      true,
			CompilerError: stringPtr("Unsupported file type"),
		}, nil
	}

	cmd.Dir = safeDir
	output, err := cmd.CombinedOutput()

	if err != nil {
		errorMsg := sanitizeCompilerOutput(string(output), safeName)
		return &CompileResponse{
			HasError:      true,
			CompilerError: stringPtr(errorMsg),
		}, nil
	}

	return &CompileResponse{
		HasError:      false,
		CompilerError: nil,
	}, nil
}

func sanitizeCompilerOutput(output, fileName string) string {
	lines := strings.Split(output, "\n")
	var sanitizedLines []string
	
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		
		line = regexp.MustCompile(`/tmp/compile_[a-f0-9-]+/`).ReplaceAllString(line, "")
		
		if strings.Contains(line, fileName) || 
		   strings.Contains(line, "error") || 
		   strings.Contains(line, "warning") ||
		   strings.Contains(line, ":") {
			sanitizedLines = append(sanitizedLines, line)
		}
	}
	
	result := strings.Join(sanitizedLines, "\n")
	if len(result) > 1000 {
		result = result[:1000] + "... (output truncated)"
	}
	
	return result
}

func stringPtr(s string) *string {
	return &s
}