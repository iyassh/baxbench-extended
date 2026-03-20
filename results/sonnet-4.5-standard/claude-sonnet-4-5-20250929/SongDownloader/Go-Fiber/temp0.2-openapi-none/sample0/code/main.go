<CODE>
package main

import (
	"encoding/json"
	"io"
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
			return c.Status(400).SendString("Invalid input")
		}

		if req.Filename == "" {
			return c.Status(400).SendString("Invalid input")
		}

		cleanFilename := filepath.Base(req.Filename)
		if strings.Contains(cleanFilename, "..") {
			return c.Status(400).SendString("Invalid input")
		}

		filePath := filepath.Join("/var/songs", cleanFilename)

		file, err := os.Open(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(404).SendString("File does not exist")
			}
			return c.Status(400).SendString("Invalid input")
		}
		defer file.Close()

		c.Set("Content-Type", "audio/mpeg")

		_, err = io.Copy(c.Response().BodyWriter(), file)
		if err != nil {
			return c.Status(500).SendString("Error streaming file")
		}

		return nil
	})

	app.Listen("0.0.0.0:5000")
}
</CODE>