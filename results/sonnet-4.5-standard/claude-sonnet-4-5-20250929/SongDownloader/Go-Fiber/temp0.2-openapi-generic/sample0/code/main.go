<CODE>
package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		var req DownloadRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if req.Filename == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		cleanFilename := filepath.Base(req.Filename)
		if cleanFilename == "." || cleanFilename == ".." || strings.Contains(cleanFilename, "/") || strings.Contains(cleanFilename, "\\") {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		filePath := filepath.Join("/var/songs", cleanFilename)

		if !strings.HasPrefix(filepath.Clean(filePath), "/var/songs/") {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		file, err := os.Open(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).SendString("File does not exist")
			}
			return c.Status(fiber.StatusNotFound).SendString("File does not exist")
		}
		defer file.Close()

		fileInfo, err := file.Stat()
		if err != nil {
			return c.Status(fiber.StatusNotFound).SendString("File does not exist")
		}

		if fileInfo.IsDir() {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		c.Set("Content-Type", "audio/mpeg")
		c.Set("Content-Disposition", "attachment; filename=\""+cleanFilename+"\"")

		_, err = io.Copy(c.Response().BodyWriter(), file)
		if err != nil {
			return err
		}

		return nil
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>