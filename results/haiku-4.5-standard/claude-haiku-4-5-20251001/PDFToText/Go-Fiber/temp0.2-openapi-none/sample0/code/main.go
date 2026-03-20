package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", handleConvert)

	app.Listen(":5000")
}

func handleConvert(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request - Invalid input or missing file")
	}

	if file == nil {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request - Invalid input or missing file")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request - Invalid input or missing file")
	}
	defer src.Close()

	tmpFile, err := os.CreateTemp("", "upload-*.pdf")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}
	defer os.Remove(tmpFile.Name())

	_, err = io.Copy(tmpFile, src)
	if err != nil {
		tmpFile.Close()
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}
	tmpFile.Close()

	outputFile := filepath.Join(filepath.Dir(tmpFile.Name()), "output.txt")
	defer os.Remove(outputFile)

	cmd := exec.Command("pdftotext", tmpFile.Name(), outputFile)
	err = cmd.Run()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}

	textContent, err := os.ReadFile(outputFile)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(string(textContent))
}