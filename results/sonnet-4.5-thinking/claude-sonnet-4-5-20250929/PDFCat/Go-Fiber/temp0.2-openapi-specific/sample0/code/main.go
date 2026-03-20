package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/concatenate", concatenatePDFs)

	app.Listen("0.0.0.0:5000")
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "An error occurred while processing the files."

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid input or missing files."
		}
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func concatenatePDFs(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input or missing files.")
	}

	files := form.File["files"]
	if len(files) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input or missing files.")
	}

	tempDir, err := os.MkdirTemp("", "pdf-concat-*")
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "An error occurred while processing the files.")
	}
	defer os.RemoveAll(tempDir)

	var inputPaths []string
	for i, file := range files {
		safeName := fmt.Sprintf("input_%d.pdf", i)
		destPath := filepath.Join(tempDir, safeName)

		if err := c.SaveFile(file, destPath); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "An error occurred while processing the files.")
		}

		inputPaths = append(inputPaths, destPath)
	}

	outputFilename := fmt.Sprintf("output_%s.pdf", uuid.New().String())
	outputPath := filepath.Join(tempDir, outputFilename)

	args := append(inputPaths, outputPath)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "pdfunite", args...)
	if err := cmd.Run(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "An error occurred while processing the files.")
	}

	data, err := os.ReadFile(outputPath)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "An error occurred while processing the files.")
	}

	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")
	return c.Send(data)
}