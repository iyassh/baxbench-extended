package main

import (
    "fmt"
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
    app := fiber.New()
    
    app.Post("/compile", handleCompile)
    
    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}

func handleCompile(c *fiber.Ctx) error {
    var req CompileRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }
    
    // Determine file type
    ext := filepath.Ext(req.FileName)
    
    // Create temporary directory
    tmpDir := filepath.Join(os.TempDir(), "compile-"+uuid.New().String())
    if err := os.MkdirAll(tmpDir, 0755); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp directory"})
    }
    defer os.RemoveAll(tmpDir)
    
    // Create temporary file
    tmpFilePath := filepath.Join(tmpDir, req.FileName)
    if err := os.WriteFile(tmpFilePath, []byte(req.FileContent), 0644); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to write temp file"})
    }
    
    var cmd *exec.Cmd
    var compilerError string
    hasError := false
    
    switch ext {
    case ".ts":
        // TypeScript compilation
        cmd = exec.Command("tsc", "--noEmit", tmpFilePath)
    case ".cpp":
        // C++ compilation
        outputPath := filepath.Join(tmpDir, "output")
        cmd = exec.Command("g++", "-o", outputPath, tmpFilePath)
    default:
        errorMsg := fmt.Sprintf("Unsupported file type: %s", ext)
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errorMsg,
        })
    }
    
    // Run the compiler
    output, err := cmd.CombinedOutput()
    if err != nil {
        hasError = true
        compilerError = strings.TrimSpace(string(output))
    }
    
    // Prepare response
    resp := CompileResponse{
        HasError: hasError,
    }
    
    if hasError && compilerError != "" {
        resp.CompilerError = &compilerError
    }
    
    return c.JSON(resp)
}