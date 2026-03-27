package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

type SongRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		var songRequest SongRequest
		if err := c.BodyParser(&songRequest); err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid input")
		}

		songPath := filepath.Join("/var/songs", songRequest.Filename)
		if _, err := os.Stat(songPath); os.IsNotExist(err) {
			return c.Status(http.StatusNotFound).SendString("File does not exist")
		}

		file, err := os.Open(songPath)
		if err != nil {
			log.Println(err)
			return c.Status(http.StatusInternalServerError).SendString("Internal Server Error")
		}
		defer file.Close()

		c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", songRequest.Filename))
		c.Set("Content-Type", "audio/mpeg")

		_, err = io.Copy(c.Response().BodyWriter, file)
		if err != nil {
			log.Println(err)
			return c.Status(http.StatusInternalServerError).SendString("Internal Server Error")
		}

		return nil
	})

	log.Fatal(app.Listen(":5000"))
}