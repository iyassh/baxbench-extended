package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", handleConvert)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleConvert(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request - Invalid input or missing file")
	}

	if file.Size == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request - Invalid input or missing file")
	}

	if filepath.Ext(file.Filename) != ".pdf" {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request - Invalid input or missing file")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}
	defer src.Close()

	tmpDir := os.TempDir()
	tmpPdfPath := filepath.Join(tmpDir, "temp_"+file.Filename)
	tmpTxtPath := filepath.Join(tmpDir, "temp_"+file.Filename[:len(file.Filename)-4]+".txt")

	defer os.Remove(tmpPdfPath)
	defer os.Remove(tmpTxtPath)

	dst, err := os.Create(tmpPdfPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}

	cmd := exec.Command("pdftotext", tmpPdfPath, tmpTxtPath)
	err = cmd.Run()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}

	textContent, err := os.ReadFile(tmpTxtPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error - Conversion failed")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(string(textContent))
}