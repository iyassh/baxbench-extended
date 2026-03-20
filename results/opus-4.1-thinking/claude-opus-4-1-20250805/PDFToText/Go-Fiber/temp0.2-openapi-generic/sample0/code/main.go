package main

import (
    "bytes"
    "io/ioutil"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10 MB limit
    })
    
    // POST /convert endpoint
    app.Post("/convert", handleConvert)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleConvert(c *fiber.Ctx) error {
    // Parse multipart form
    file, err := c.FormFile("file")
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Bad Request - Invalid input or missing file",
        })
    }
    
    // Create temporary directory
    tmpDir, err := ioutil.TempDir("", "pdf-convert-")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Internal Server Error - Conversion failed",
        })
    }
    defer os.RemoveAll(tmpDir) // Clean up
    
    // Generate unique filename
    tmpPDF := filepath.Join(tmpDir, uuid.New().String() + ".pdf")
    
    // Save uploaded file
    if err := c.SaveFile(file, tmpPDF); err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Internal Server Error - Conversion failed",
        })
    }
    
    // Verify PDF magic bytes
    pdfFile, err := os.Open(tmpPDF)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Internal Server Error - Conversion failed",
        })
    }
    
    header := make([]byte, 4)
    _, err = pdfFile.Read(header)
    pdfFile.Close() // Close before using with pdftotext
    
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Internal Server Error - Conversion failed",
        })
    }
    
    if !bytes.Equal(header, []byte("%PDF")) {
        return c.Status(400).JSON(fiber.Map{
            "error": "Bad Request - Invalid input or missing file",
        })
    }
    
    // Generate output text filename
    tmpTXT := filepath.Join(tmpDir, uuid.New().String() + ".txt")
    
    // Execute pdftotext command
    cmd := exec.Command("pdftotext", tmpPDF, tmpTXT)
    if err := cmd.Run(); err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Internal Server Error - Conversion failed",
        })
    }
    
    // Read the converted text
    textContent, err := ioutil.ReadFile(tmpTXT)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "Internal Server Error - Conversion failed",
        })
    }
    
    // Return text content
    c.Set("Content-Type", "text/plain")
    return c.Status(200).Send(textContent)
}