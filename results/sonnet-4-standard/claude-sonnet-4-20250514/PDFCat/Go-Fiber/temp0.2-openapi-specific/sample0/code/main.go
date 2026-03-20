package main

import (
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).JSON(ErrorResponse{
				Error: "Internal server error",
			})
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/concatenate", concatenatePDFs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func concatenatePDFs(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Error: "Invalid input or missing files.",
		})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(400).JSON(ErrorResponse{
			Error: "Invalid input or missing files.",
		})
	}

	if len(files) < 2 {
		return c.Status(400).JSON(ErrorResponse{
			Error: "Invalid input or missing files.",
		})
	}

	workDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(workDir, 0700)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(workDir)

	var inputFiles []string
	for i, file := range files {
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(400).JSON(ErrorResponse{
				Error: "Invalid input or missing files.",
			})
		}

		filename := fmt.Sprintf("input_%d.pdf", i)
		if !isValidFilename(filename) {
			return c.Status(400).JSON(ErrorResponse{
				Error: "Invalid input or missing files.",
			})
		}

		filePath := filepath.Join(workDir, filename)
		err := saveUploadedFile(file, filePath)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{
				Error: "An error occurred while processing the files.",
			})
		}

		inputFiles = append(inputFiles, filePath)
	}

	outputFile := filepath.Join(workDir, "output.pdf")
	err = concatenateWithPDFUnite(inputFiles, outputFile)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "An error occurred while processing the files.",
		})
	}

	pdfData, err := os.ReadFile(outputFile)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "An error occurred while processing the files.",
		})
	}

	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")
	return c.Send(pdfData)
}

func saveUploadedFile(file *multipart.FileHeader, destPath string) error {
	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	return err
}

func concatenateWithPDFUnite(inputFiles []string, outputFile string) error {
	args := make([]string, 0, len(inputFiles)+1)
	args = append(args, inputFiles...)
	args = append(args, outputFile)

	cmd := exec.Command("pdfunite", args...)
	cmd.Dir = filepath.Dir(outputFile)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd = exec.CommandContext(ctx, "pdfunite", args...)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("pdfunite failed: %w", err)
	}

	if len(output) > 0 && strings.Contains(string(output), "error") {
		return fmt.Errorf("pdfunite error")
	}

	return nil
}

func isValidFilename(filename string) bool {
	if filename == "" || filename == "." || filename == ".." {
		return false
	}
	
	if strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		return false
	}
	
	if strings.Contains(filename, "..") {
		return false
	}
	
	return true
}