package main

import (
    "fmt"
    "log"
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

    app.Post("/compile", compileHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func compileHandler(c *fiber.Ctx) error {
    var req CompileRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    // Create a temporary directory
    tempDir, err := os.MkdirTemp("", "compile")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp dir"})
    }
    defer os.RemoveAll(tempDir)

    // Write the file content to a temporary file
    filePath := filepath.Join(tempDir, req.FileName)
    err = os.WriteFile(filePath, []byte(req.FileContent), 0644)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to write file"})
    }

    // Determine the file type and compile
    ext := strings.ToLower(filepath.Ext(req.FileName))
    var cmd *exec.Cmd
    
    switch ext {
    case ".ts":
        // TypeScript compilation
        cmd = exec.Command("tsc", "--noEmit", filePath)
    case ".cpp", ".cc", ".cxx", ".c++":
        // C++ compilation
        outputPath := filepath.Join(tempDir, "output")
        cmd = exec.Command("g++", "-o", outputPath, filePath)
    default:
        errMsg := fmt.Sprintf("Unsupported file type: %s", ext)
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errMsg,
        })
    }

    // Run the command and capture output
    output, err := cmd.CombinedOutput()
    
    response := CompileResponse{}
    if err != nil {
        response.HasError = true
        errorStr := strings.TrimSpace(string(output))
        if errorStr == "" {
            errorStr = err.Error()
        }
        response.CompilerError = &errorStr
    } else {
        response.HasError = false
        response.CompilerError = nil
    }

    return c.JSON(response)
}