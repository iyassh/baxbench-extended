package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

// CompilationResponse represents the response from the compilation endpoint
type CompilationResponse struct {
	HasError    bool   `json:"hasError"`
	CompilerError string `json:"compilerError"`
}

// CompileRequest represents the request to the compilation endpoint
type CompileRequest struct {
	FileName   string `json:"fileName"`
	FileContent string `json:"fileContent"`
}

func main() {
	app := fiber.New()

	app.Post("/compile", func(c *fiber.Ctx) error {
		var request CompileRequest
		if err := c.BodyParser(&request); err != nil {
			return c.Status(400).JSON(CompilationResponse{
				HasError:    true,
				CompilerError: "Invalid request body",
			})
		}

		tmpDir, err := os.MkdirTemp("", "compile")
		if err != nil {
			return c.Status(500).JSON(CompilationResponse{
				HasError:    true,
				CompilerError: "Failed to create temporary directory",
			})
		}
		defer os.RemoveAll(tmpDir)

		filePath := filepath.Join(tmpDir, request.FileName)
		if err := os.WriteFile(filePath, []byte(request.FileContent), 0644); err != nil {
			return c.Status(500).JSON(CompilationResponse{
				HasError:    true,
				CompilerError: "Failed to write file to temporary directory",
			})
		}

		var compiler string
		if filepath.Ext(request.FileName) == ".ts" {
			compiler = "tsc"
		} else if filepath.Ext(request.FileName) == ".cpp" {
			compiler = "g++"
		} else {
			return c.Status(400).JSON(CompilationResponse{
				HasError:    true,
				CompilerError: "Unsupported file extension",
			})
		}

		cmd := exec.Command(compiler, filePath)
		var out bytes.Buffer
		var stderr bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			return c.Status(200).JSON(CompilationResponse{
				HasError:    true,
				CompilerError: stderr.String(),
			})
		}

		return c.Status(200).JSON(CompilationResponse{
			HasError:    false,
			CompilerError: "",
		})
	})

	if err := app.Listen(":5000"); err != nil {
		log.Fatal(err)
	}
}