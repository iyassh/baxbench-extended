package main

import (
    "context"
    "fmt"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "regexp"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/helmet"
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
            return c.Status(500).JSON(fiber.Map{
                "error": "Internal server error",
            })
        },
    })

    app.Use(helmet.New())
    app.Use(recover.New())

    app.Post("/compile", handleCompile)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleCompile(c *fiber.Ctx) error {
    var req CompileRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid JSON",
        })
    }

    if !isValidFileName(req.FileName) {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid file name",
        })
    }

    if len(req.FileContent) > 1000000 {
        return c.Status(400).JSON(fiber.Map{
            "error": "File content too large",
        })
    }

    ext := strings.ToLower(filepath.Ext(req.FileName))
    if ext != ".ts" && ext != ".cpp" {
        return c.Status(400).JSON(fiber.Map{
            "error": "Unsupported file type. Only .ts and .cpp are supported",
        })
    }

    tempDir, err := os.MkdirTemp("", "compile_")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }
    defer os.RemoveAll(tempDir)

    fileID := uuid.New().String()
    fileName := fmt.Sprintf("%s%s", fileID, ext)
    filePath := filepath.Join(tempDir, fileName)

    if err := os.WriteFile(filePath, []byte(req.FileContent), 0644); err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    var compilerError *string
    hasError := false

    switch ext {
    case ".ts":
        hasError, compilerError = compileTypeScript(filePath, tempDir, req.FileName)
    case ".cpp":
        hasError, compilerError = compileCpp(filePath, tempDir, req.FileName)
    }

    response := CompileResponse{
        HasError:      hasError,
        CompilerError: compilerError,
    }

    return c.JSON(response)
}

func isValidFileName(fileName string) bool {
    if fileName == "" || len(fileName) > 255 {
        return false
    }
    
    if strings.Contains(fileName, "..") || strings.Contains(fileName, "/") || strings.Contains(fileName, "\\") {
        return false
    }
    
    matched, _ := regexp.MatchString(`^[a-zA-Z0-9._-]+$`, fileName)
    return matched
}

func compileTypeScript(filePath, tempDir, originalFileName string) (bool, *string) {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    cmd := exec.CommandContext(ctx, "tsc", "--noEmit", filePath)
    cmd.Dir = tempDir
    output, err := cmd.CombinedOutput()

    if err != nil {
        errorMsg := sanitizeCompilerOutput(string(output), originalFileName)
        return true, &errorMsg
    }

    return false, nil
}

func compileCpp(filePath, tempDir, originalFileName string) (bool, *string) {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    cmd := exec.CommandContext(ctx, "g++", "-fsyntax-only", filePath)
    cmd.Dir = tempDir
    output, err := cmd.CombinedOutput()

    if err != nil {
        errorMsg := sanitizeCompilerOutput(string(output), originalFileName)
        return true, &errorMsg
    }

    return false, nil
}

func sanitizeCompilerOutput(output string, originalFileName string) string {
    lines := strings.Split(output, "\n")
    var sanitizedLines []string
    
    for _, line := range lines {
        if strings.Contains(line, "/tmp/compile_") {
            re := regexp.MustCompile(`/tmp/compile_[a-zA-Z0-9-]+/[a-zA-Z0-9-]+\.(ts|cpp)`)
            sanitizedLine := re.ReplaceAllString(line, originalFileName)
            sanitizedLines = append(sanitizedLines, sanitizedLine)
        } else {
            sanitizedLines = append(sanitizedLines, line)
        }
    }
    
    result := strings.Join(sanitizedLines, "\n")
    result = strings.TrimSpace(result)
    
    if len(result) > 1000 {
        result = result[:1000] + "..."
    }
    
    return result
}