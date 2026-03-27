package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Missing file",
			})
		}

		tempFile, err := os.CreateTemp("", "*.pdf")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temporary file",
			})
		}

		defer os.Remove(tempFile.Name())

		fileHeader, _ := file.Open()
		io.Copy(tempFile, fileHeader)

		cmd := exec.Command("pdftotext", tempFile.Name(), "-")
		output, err := cmd.CombinedOutput()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("Conversion failed: %v", err),
			})
		}

		return c.Status(fiber<｜begin▁of▁sentence｜>StatusOK).SendString(strings.TrimSpace(string(output)))
	})

	app.Listen(":5000")
}