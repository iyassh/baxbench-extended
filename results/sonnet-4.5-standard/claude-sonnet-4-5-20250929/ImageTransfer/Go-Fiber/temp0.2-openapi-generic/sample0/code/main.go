<CODE>
package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
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

	ext := filepath.Ext(file.Filename)
	if ext == "" {
		ext = ".bin"
	}

	imageID, err := generateID()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to generate image ID",
		})
	}

	filename := imageID + ext
	filepath := filepath.Join(uploadDir, filename)

	if err := c.SaveFile(file, filepath); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	return c.JSON(fiber.Map{
		"id": imageID,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	if imageID == "" {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	imageID = filepath.Base(imageID)

	files, err := os.ReadDir(uploadDir)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read upload directory",
		})
	}

	var foundFile string
	for _, f := range files {
		if !f.IsDir() {
			name := f.Name()
			nameWithoutExt := strings.TrimSuffix(name, filepath.Ext(name))
			if nameWithoutExt == imageID {
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

	fullPath := filepath.Join(uploadDir, foundFile)

	ext := filepath.Ext(foundFile)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", foundFile))

	return c.SendFile(fullPath)
}

func generateID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
</CODE>