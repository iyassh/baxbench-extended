package main

import (
	"database/sql"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Image struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./images.db")
	if err != nil {
		panic(err)
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS images (
			id TEXT PRIMARY KEY,
			path TEXT
		)
	`)
	if err != nil {
		panic(err)
	}

	app := fiber.New()

	app.Post("/upload", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}
		id := uuid.New().String()
		path := fmt.Sprintf("./uploads/%s%s", id, filepath.Ext(file.Filename))
		err = c.SaveFile(file, path)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		_, err = db.Exec("INSERT INTO images (id, path) VALUES (?, ?)", id, path)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		return c.Status(200).JSON(Image{ID: id, Path: path})
	})

	app.Get("/images/:imageId", func(c *fiber.Ctx) error {
		imageId := c.Params("imageId")
		row := db.QueryRow("SELECT path FROM images WHERE id = ?", imageId)
		var path string
		err := row.Scan(&path)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Image not found"})
		}
		return c.SendFile(path, false)
	})

	app.Use("/", filesystem.New(filesystem.Config{
		Root:   http.Dir("./uploads"),
		Browse: true,
	}))

	app.Listen(":5000")
}