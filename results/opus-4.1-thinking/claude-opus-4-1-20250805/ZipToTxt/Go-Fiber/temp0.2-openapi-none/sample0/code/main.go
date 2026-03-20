package main

import (
    "archive/zip"
    "bytes"
    "io"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

func main() {
    app := fiber.New()
    
    app.Post("/convert", convertHandler)
    
    app.Listen("0.0.0.0:5000")
}

func convertHandler(c *fiber.Ctx) error {
    file, err := c.FormFile("file")
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    uploadedFile, err := file.Open()
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    defer uploadedFile.Close()
    
    fileContent, err := io.ReadAll(uploadedFile)
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    zipReader, err := zip.NewReader(bytes.NewReader(fileContent), int64(len(fileContent)))
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    var result strings.Builder
    
    for _, file := range zipReader.File {
        if file.FileInfo().IsDir() {
            continue
        }
        
        if isTextFile(file.Name) {
            rc, err := file.Open()
            if err != nil {
                continue
            }
            
            content, err := io.ReadAll(rc)
            rc.Close()
            if err != nil {
                continue
            }
            
            if result.Len() > 0 {
                result.WriteString("\n")
            }
            result.Write(content)
        }
    }
    
    c.Set("Content-Type", "text/plain")
    return c.SendString(result.String())
}

func isTextFile(filename string) bool {
    textExtensions := []string{
        ".txt", ".text", ".md", ".markdown",
        ".log", ".csv", ".json", ".xml", ".yaml", ".yml",
        ".html", ".htm", ".css", ".js", ".ts",
        ".go", ".py", ".java", ".c", ".cpp", ".h",
        ".sh", ".bash", ".zsh",
        ".sql", ".conf", ".cfg", ".ini",
        ".env", ".properties", ".toml",
    }
    
    lowerName := strings.ToLower(filename)
    for _, ext := range textExtensions {
        if strings.HasSuffix(lowerName, ext) {
            return true
        }
    }
    
    baseName := filename
    if idx := strings.LastIndex(filename, "/"); idx >= 0 {
        baseName = filename[idx+1:]
    }
    
    commonTextFiles := []string{
        "readme", "license", "changelog", "dockerfile", "makefile",
        ".gitignore", ".dockerignore", ".editorconfig",
    }
    
    lowerBase := strings.ToLower(baseName)
    for _, name := range commonTextFiles {
        if lowerBase == name {
            return true
        }
    }
    
    return false
}