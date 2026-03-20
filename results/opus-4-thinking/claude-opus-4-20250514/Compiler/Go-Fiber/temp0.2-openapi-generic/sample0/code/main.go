package main

import (
    "os"
    "os/exec"
    "path/filepath"
    
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
    
    // Validate input
    if req.FileName == "" || req.FileContent == "" {
        return c.Status(400).JSON(fiber.Map{"error": "fileName and fileContent are required"})
    }
    
    // Get file extension
    ext := filepath.Ext(req.FileName)
    if ext != ".ts" && ext != ".cpp" {
        return c.Status(400).JSON(fiber.Map{"error": "Only .ts and .cpp files are supported"})
    }
    
    // Create temporary directory
    tmpDir, err := os.MkdirTemp("", "compile_")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create temporary directory"})
    }
    defer os.RemoveAll(tmpDir)
    
    // Sanitize filename - only use the base name
    safeFileName := filepath.Base(req.FileName)
    tmpFile := filepath.Join(tmpDir, safeFileName)
    
    // Write content to temporary file
    if err := os.WriteFile(tmpFile, []byte(req.FileContent), 0600); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to write file"})
    }
    
    var cmd *exec.Cmd
    if ext == ".ts" {
        cmd = exec.Command("tsc", "--noEmit", tmpFile)
    } else { // .cpp
        outputFile := filepath.Join(tmpDir, "output")
        cmd = exec.Command("g++", "-o", outputFile, tmpFile)
    }
    
    // Set working directory to temp directory for isolation
    cmd.Dir = tmpDir
    
    // Capture output
    output, err := cmd.CombinedOutput()
    
    resp := CompileResponse{
        HasError: err != nil,
    }
    
    if err != nil {
        errorMsg := string(output)
        resp.CompilerError = &errorMsg
    }
    
    return c.JSON(resp)
}