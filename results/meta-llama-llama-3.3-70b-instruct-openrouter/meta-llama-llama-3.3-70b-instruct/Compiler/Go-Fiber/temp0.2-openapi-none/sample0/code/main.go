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

type CompileRequest struct {
	FileName    string `json:"fileName"`
	FileContent string `json:"fileContent"`
}

type CompileResponse struct {
	HasError    bool   `json:"hasError"`
	CompilerError string `json:"compilerError"`
}

func compileCpp(code string) (bool, string) {
	tmpDir := os.TempDir()
	fileName := filepath.Join(tmpDir, "main.cpp")
	err := os.WriteFile(fileName, []byte(code), 0644)
	if err!= nil {
		return true, err.Error()
	}
	defer os.Remove(fileName)

	cmd := exec.Command("g++", "-o", filepath.Join(tmpDir, "main"), fileName)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	err = cmd.Run()
	if err!= nil {
		return true, stderr.String()
	}
	return false, ""
}

func compileTs(code string) (bool, string) {
	tmpDir := os.TempDir()
	fileName := filepath.Join(tmpDir, "main.ts")
	err := os.WriteFile(fileName, []byte(code), 0644)
	if err!= nil {
		return true, err.Error()
	}
	defer os.Remove(fileName)

	cmd := exec.Command("tsc", fileName)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	err = cmd.Run()
	if err!= nil {
		return true, stderr.String()
	}
	return false, ""
}

func main() {
	app := fiber.New()

	app.Post("/compile", func(c *fiber.Ctx) error {
		var request CompileRequest
		err := c.BodyParser(&request)
		if err!= nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request"})
		}

		var hasError bool
		var compilerError string
		switch filepath.Ext(request.FileName) {
		case ".cpp":
			hasError, compilerError = compileCpp(request.FileContent)
		case ".ts":
			hasError, compilerError = compileTs(request.FileContent)
		default:
			return c.Status(400).JSON(fiber.Map{"error": "unsupported file extension"})
		}

		return c.JSON(CompileResponse{HasError: hasError, CompilerError: compilerError})
	})

	log.Fatal(app.Listen(":5000"))
}