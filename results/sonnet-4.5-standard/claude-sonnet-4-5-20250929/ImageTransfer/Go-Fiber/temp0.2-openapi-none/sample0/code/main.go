<CODE>
package main

import (
	"fmt"
	"log"
	"mime"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const uploadDir = "./uploads"

func main() {
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/upload", handleUpload)
	app.Get("/images/:imageId", handleGetImage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleUpload(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	imageId := uuid.New().String()
	ext := filepath.Ext(file.Filename)
	filename := imageId + ext

	filepath := filepath.Join(uploadDir, filename)
	if err := c.SaveFile(file, filepath); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	return c.JSON(fiber.Map{
		"id": imageId,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageId := c.Params("imageId")

	files, err := os.ReadDir(uploadDir)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read upload directory",
		})
	}

	var foundFile string
	for _, file := range files {
		if !file.IsDir() {
			name := file.Name()
			nameWithoutExt := name[:len(name)-len(filepath.Ext(name))]
			if nameWithoutExt == imageId {
				foundFile = name
				break
			}
		}
	}

	if foundFile == "" {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	filePath := filepath.Join(uploadDir, foundFile)
	ext := filepath.Ext(foundFile)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", foundFile))

	return c.SendFile(filePath)
}
</CODE>