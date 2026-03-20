package main

import (
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

func main() {
    app := fiber.New()
    
    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        return c.Next()
    })
    
    app.Post("/compile", handleCompile)
    
    app.Listen("0.0.0.0:5000")
}

func handleCompile(c *fiber.Ctx) error {
    var req CompileRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }
    
    // Validate inputs
    if req.FileName == "" || req.FileContent == "" {
        return c.Status(400).JSON(fiber.Map{
            "error": "Missing required fields",
        })
    }
    
    // Sanitize filename - only use the base name
    safeFileName := filepath.Base(req.FileName)
    
    // Additional validation for filename
    if !isValidFileName(safeFileName) {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid filename",
        })
    }
    
    // Get file extension
    ext := filepath.Ext(safeFileName)
    if ext != ".ts" && ext != ".cpp" {
        return c.Status(400).JSON(fiber.Map{
            "error": "Unsupported file type",
        })
    }
    
    // Create temporary directory for this compilation
    tempDir, err := os.MkdirTemp("", "compile-")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to create temporary directory",
        })
    }
    defer os.RemoveAll(tempDir)
    
    // Create the file in temp directory
    filePath := filepath.Join(tempDir, safeFileName)
    if err := os.WriteFile(filePath, []byte(req.FileContent), 0644); err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Failed to write file",
        })
    }
    
    var cmd *exec.Cmd
    
    if ext == ".ts" {
        // TypeScript compilation
        cmd = exec.Command("tsc", "--noEmit", safeFileName)
        cmd.Dir = tempDir
    } else if ext == ".cpp" {
        // C++ compilation
        outputFile := strings.TrimSuffix(safeFileName, ".cpp")
        cmd = exec.Command("g++", "-o", outputFile, safeFileName)
        cmd.Dir = tempDir
    }
    
    // Execute command and capture output
    output, err := cmd.CombinedOutput()
    
    resp := CompileResponse{}
    
    if err != nil {
        resp.HasError = true
        errorStr := string(output)
        // Clean up any absolute paths in error messages to avoid information disclosure
        errorStr = strings.ReplaceAll(errorStr, tempDir+"/", "")
        errorStr = strings.ReplaceAll(errorStr, tempDir, "")
        resp.CompilerError = &errorStr
    } else {
        resp.HasError = false
        resp.CompilerError = nil
    }
    
    return c.JSON(resp)
}

// isValidFileName checks if the filename is safe to use
func isValidFileName(filename string) bool {
    // Only allow alphanumeric, dots, dashes, and underscores
    matched, _ := regexp.MatchString(`^[a-zA-Z0-9._-]+$`, filename)
    if !matched {
        return false
    }
    
    // Don't allow .. or absolute paths
    if strings.Contains(filename, "..") || filepath.IsAbs(filename) {
        return false
    }
    
    // Must end with .ts or .cpp
    ext := filepath.Ext(filename)
    return ext == ".ts" || ext == ".cpp"
}