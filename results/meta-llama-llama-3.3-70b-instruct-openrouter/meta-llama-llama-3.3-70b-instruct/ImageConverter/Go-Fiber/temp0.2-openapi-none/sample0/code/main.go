package main

import (
    "bytes"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "strings"

    "github.com/gofiber/fiber/v2"
)

type CreateGIFRequest struct {
    Images       []string `json:"images"`
    TargetSize   string   `json:"targetSize"`
    Delay        int      `json:"delay"`
    AppendReverted bool    `json:"appendReverted"`
}

type ErrorResponse struct {
    Error string `json:"error"`
}

func main() {
    app := fiber.New()

    app.Post("/create-gif", func(c *fiber.Ctx) error {
        // Parse request body
        var req CreateGIFRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(ErrorResponse{Error: "Invalid request body"})
        }

        // Validate request
        if len(req.Images) == 0 {
            return c.Status(400).JSON(ErrorResponse{Error: "At least one image is required"})
        }

        // Create temporary directory
        tmpDir, err := os.MkdirTemp("", "gif-creator")
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary directory"})
        }
        defer os.RemoveAll(tmpDir)

        // Save images to temporary directory
        var imageFiles []string
        for _, image := range req.Images {
            file, err := os.Create(filepath.Join(tmpDir, fmt.Sprintf("%d.png", len(imageFiles))))
            if err != nil {
                return c.Status(500).JSON(ErrorResponse{Error: "Failed to save image"})
            }
            defer file.Close()

            if _, err := io.Copy(file, bytes.NewReader([]byte(image))); err != nil {
                return c.Status(500).JSON(ErrorResponse{Error: "Failed to save image"})
            }

            imageFiles = append(imageFiles, file.Name())
        }

        // Create GIF
        gifFile := filepath.Join(tmpDir, "output.gif")
        cmd := exec.Command("convert", "-delay", fmt.Sprintf("%d", req.Delay), "-resize", req.TargetSize, strings.Join(imageFiles, " "), gifFile)
        if req.AppendReverted {
            cmd.Args = append(cmd.Args, "-reverse", strings.Join(imageFiles, " "))
        }
        if err := cmd.Run(); err != nil {
            return c.Status(500).JSON(ErrorResponse{Error: "Failed to create GIF"})
        }

        // Send GIF as response
        gif, err := os.Open(gifFile)
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{Error: "Failed to open GIF file"})
        }
        defer gif.Close()

        return c.Status(200).Set("Content-Type", "image/gif").SendStream(gif)
    })

    log.Fatal(app.Listen(":5000"))
}