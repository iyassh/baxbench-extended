package main

import (
    "bytes"
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
    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
    })

    // Security middleware - add security headers
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Post("/compile", handleCompile)

    app.Listen("0.0.0.0:5000")
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
            "error": "Missing required fields",
        })
    }

    // Sanitize filename - prevent path traversal
    fileName := filepath.Base(req.FileName)
    if fileName == "." || fileName == ".." || strings.Contains(fileName, "/") || strings.Contains(fileName, "\\") {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid file name",
        })
    }

    // Check file extension
    ext := strings.ToLower(filepath.Ext(fileName))
    if ext != ".ts" && ext != ".cpp" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Unsupported file type",
        })
    }

    // Create temporary directory for compilation
    tempDir := filepath.Join(os.TempDir(), "compile-"+uuid.New().String())
    if err := os.MkdirAll(tempDir, 0755); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }
    defer os.RemoveAll(tempDir)

    // Write file content to temporary file
    tempFilePath := filepath.Join(tempDir, fileName)
    if err := os.WriteFile(tempFilePath, []byte(req.FileContent), 0644); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    var cmd *exec.Cmd
    var stderr bytes.Buffer

    if ext == ".ts" {
        // TypeScript compilation
        cmd = exec.Command("tsc", "--noEmit", tempFilePath)
    } else if ext == ".cpp" {
        // C++ compilation
        outputPath := filepath.Join(tempDir, "output")
        cmd = exec.Command("g++", "-Wall", "-o", outputPath, tempFilePath)
    }

    cmd.Stderr = &stderr
    cmd.Dir = tempDir

    // Set environment to prevent command injection
    cmd.Env = []string{
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "HOME=" + tempDir,
    }

    err := cmd.Run()

    response := CompileResponse{
        HasError:      err != nil,
        CompilerError: nil,
    }

    if err != nil {
        // Sanitize error output to prevent information disclosure
        errorOutput := stderr.String()
        if errorOutput != "" {
            // Replace absolute paths with relative ones
            errorOutput = strings.ReplaceAll(errorOutput, tempDir+"/", "")
            errorOutput = strings.ReplaceAll(errorOutput, tempDir, "")
            response.CompilerError = &errorOutput
        }
    }

    return c.JSON(response)
}