package main

import (
    "fmt"
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

func main() {
    app := fiber.New()

    app.Post("/compile", handleCompile)

    app.Listen("0.0.0.0:5000")
}

func handleCompile(c *fiber.Ctx) error {
    var req CompileRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
    }

    // Determine file type from extension
    ext := strings.ToLower(filepath.Ext(req.FileName))
    
    var hasError bool
    var compilerError *string

    switch ext {
    case ".ts":
        hasError, compilerError = compileTypeScript(req.FileContent, req.FileName)
    case ".cpp":
        hasError, compilerError = compileCpp(req.FileContent, req.FileName)
    default:
        errMsg := "Unsupported file type"
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errMsg,
        })
    }

    return c.JSON(CompileResponse{
        HasError:      hasError,
        CompilerError: compilerError,
    })
}

func compileTypeScript(content, fileName string) (bool, *string) {
    // Create temporary directory
    tmpDir, err := os.MkdirTemp("", "compile")
    if err != nil {
        errMsg := fmt.Sprintf("Failed to create temporary directory: %v", err)
        return true, &errMsg
    }
    defer os.RemoveAll(tmpDir)

    // Create file with original name in temp directory
    filePath := filepath.Join(tmpDir, fileName)
    if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
        errMsg := fmt.Sprintf("Failed to write file: %v", err)
        return true, &errMsg
    }

    // Run TypeScript compiler
    cmd := exec.Command("tsc", filePath, "--noEmit")
    output, err := cmd.CombinedOutput()

    if err != nil {
        // Compilation failed
        errMsg := strings.TrimSpace(string(output))
        if errMsg == "" {
            errMsg = "Compilation failed"
        }
        return true, &errMsg
    }

    // Compilation succeeded
    return false, nil
}

func compileCpp(content, fileName string) (bool, *string) {
    // Create temporary directory
    tmpDir, err := os.MkdirTemp("", "compile")
    if err != nil {
        errMsg := fmt.Sprintf("Failed to create temporary directory: %v", err)
        return true, &errMsg
    }
    defer os.RemoveAll(tmpDir)

    // Create file with original name in temp directory
    filePath := filepath.Join(tmpDir, fileName)
    if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
        errMsg := fmt.Sprintf("Failed to write file: %v", err)
        return true, &errMsg
    }

    // Create output file path
    outputFile := filepath.Join(tmpDir, "output")

    // Run g++ compiler
    cmd := exec.Command("g++", filePath, "-o", outputFile)
    output, err := cmd.CombinedOutput()

    if err != nil {
        // Compilation failed
        errMsg := strings.TrimSpace(string(output))
        if errMsg == "" {
            errMsg = "Compilation failed"
        }
        return true, &errMsg
    }

    // Compilation succeeded
    return false, nil
}