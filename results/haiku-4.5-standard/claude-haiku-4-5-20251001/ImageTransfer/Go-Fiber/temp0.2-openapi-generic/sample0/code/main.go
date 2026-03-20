package main

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const uploadDir = "./uploads"

func init() {
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		panic(fmt.Sprintf("Failed to create uploads directory: %v", err))
	}
}

func main() {
	app := fiber.New()

	app.Post("/upload", handleUpload)
	app.Get("/images/:imageId", handleGetImage)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func handleUpload(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	if file.Size == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File is empty",
		})
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to open file",
		})
	}
	defer src.Close()

	imageID := uuid.New().String()
	ext := filepath.Ext(file.Filename)
	if ext == "" {
		ext = ".bin"
	}

	filename := imageID + ext
	filepath := filepath.Join(uploadDir, filename)

	dst, err := os.Create(filepath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		os.Remove(filepath)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write file",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id": imageID,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	if imageID == "" || strings.ContainsAny(imageID, "/\\") {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	files, err := os.ReadDir(uploadDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	var foundFile string
	for _, file := range files {
		if !file.IsDir() && strings.HasPrefix(file.Name(), imageID) {
			foundFile = file.Name()
			break
		}
	}

	if foundFile == "" {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	filepath := filepath.Join(uploadDir, foundFile)

	fileInfo, err := os.Stat(filepath)
	if err != nil || fileInfo.IsDir() {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	ext := filepath.Ext(foundFile)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", "inline")
	c.Set("Cache-Control", "public, max-age=3600")

	return c.SendFile(filepath)
}