package main

import (
	"database/sql"
	"fmt"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"os"
)

type Image struct {
	Id  string
	Url string
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./images.db")
	if err != nil {
		fmt.Println(err)
		return
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/upload", uploadImage)
	app.Get("/images/:imageId", getImage)

	app.Use(filesystem.New(filesystem.Config{
		Root:   http.Dir("./images"),
		Browse: true,
	}))

	app.Listen(":5000")
}

func uploadImage(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	id := uuid.New().String()
	filepath := fmt.Sprintf("./images/%s", id)

	if err := c.SaveFile(file, filepath); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	_, err = db.Exec("INSERT INTO images (id, url) VALUES (?, ?)", id, fmt.Sprintf("/images/%s", id))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(200).JSON(fiber.Map{"id": id})
}

func getImage(c *fiber.Ctx) error {
	imageId := c.Params("imageId")

	var image Image
	err := db.QueryRow("SELECT url FROM images WHERE id = ?", imageId).Scan(&image.Url)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Image not found"})
	}

	return c.Redirect(image.Url)
}