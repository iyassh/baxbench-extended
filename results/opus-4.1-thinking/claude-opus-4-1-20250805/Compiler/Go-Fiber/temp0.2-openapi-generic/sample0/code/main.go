package main

import (
    "context"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "time"
    
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
    
    app.Listen("0.0.0.0:5000")
}

func handleCompile(c *fiber.Ctx) error {
    var req CompileRequest
    if err := c.BodyParser(&req); err != nil {
        errorMsg := "Invalid request body"
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errorMsg,
        })
    }
    
    // Validate input
    if req.FileName == "" {
        errorMsg := "fileName is required"
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errorMsg,
        })
    }
    
    // Get file extension
    ext := strings.ToLower(filepath.Ext(req.FileName))
    
    // Check if file type is supported
    if ext != ".ts" && ext != ".cpp" {
        errorMsg := "Unsupported file type. Only .ts and .cpp files are supported"
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errorMsg,
        })
    }
    
    // Create temporary directory
    tempDir, err := os.MkdirTemp("", "compile-")
    if err != nil {
        errorMsg := "Failed to create temporary directory"
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errorMsg,
        })
    }
    defer os.RemoveAll(tempDir)
    
    // Generate safe filename
    safeFileName := uuid.New().String() + ext
    tempFilePath := filepath.Join(tempDir, safeFileName)
    
    // Write content to temporary file
    if err := os.WriteFile(tempFilePath, []byte(req.FileContent), 0644); err != nil {
        errorMsg := "Failed to write temporary file"
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errorMsg,
        })
    }
    
    // Create context with timeout
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    
    var cmd *exec.Cmd
    
    switch ext {
    case ".ts":
        // Compile TypeScript
        cmd = exec.CommandContext(ctx, "tsc", "--noEmit", tempFilePath)
    case ".cpp":
        // Compile C++
        outputPath := filepath.Join(tempDir, "output")
        cmd = exec.CommandContext(ctx, "g++", "-o", outputPath, tempFilePath)
    }
    
    // Set working directory
    cmd.Dir = tempDir
    
    // Execute command and capture output
    output, err := cmd.CombinedOutput()
    
    if err != nil {
        // Compilation failed or timeout
        errorMsg := strings.TrimSpace(string(output))
        if ctx.Err() == context.DeadlineExceeded {
            errorMsg = "Compilation timeout"
        } else if errorMsg != "" {
            // Replace temp file path with original filename in error messages
            errorMsg = strings.ReplaceAll(errorMsg, tempFilePath, req.FileName)
        } else {
            errorMsg = "Compilation failed"
        }
        
        return c.JSON(CompileResponse{
            HasError:      true,
            CompilerError: &errorMsg,
        })
    }
    
    // Compilation succeeded
    return c.JSON(CompileResponse{
        HasError:      false,
        CompilerError: nil,
    })
}