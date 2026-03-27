package main

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"mime/multipart"
)

type Image struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

var images = make(map[string]string)

func main() {
	app := fiber.New()

	app.Post("/upload", uploadImage)
	app.Get("/images/:imageId", getImage)

	app.Listen(":5000")
}

func uploadImage(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}

	imageId := uuid.New().String()
	images[imageId] = file.Filename

	return c.Status(200).JSON(Image{ID: imageId, URL: "/images/" + imageId})
}

func getImage(c *fiber.Ctx) error {
	imageId := c.Params("imageId")

	file, ok := images[imageId]
	if !ok {
		return c.Status(404).JSON(fiber.Map{"error": "Image not found"})
	}

	return c.Download(file)
}