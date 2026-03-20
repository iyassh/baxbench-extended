package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const uploadDir = "./uploads"

func main() {
	if err := os.MkdirAll(uploadDir, 0750); err != nil {
		panic(err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	app.Post("/upload", handleUpload)
	app.Get("/images/:imageId", handleGetImage)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func handleUpload(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided or invalid form data",
		})
	}

	if fileHeader.Size == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Empty file",
		})
	}

	// Open the uploaded file to detect content type
	src, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read uploaded file",
		})
	}
	defer src.Close()

	// Read first 512 bytes to detect content type
	buf := make([]byte, 512)
	n, err := src.Read(buf)
	if err != nil && err != io.EOF {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read file content",
		})
	}
	detectedType := http.DetectContentType(buf[:n])

	// Reset to beginning
	if seeker, ok := src.(io.Seeker); ok {
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process file",
			})
		}
	}

	// Determine extension from original filename
	origExt := filepath.Ext(fileHeader.Filename)
	// Sanitize extension - only allow alphanumeric characters and dots
	origExt = sanitizeExtension(origExt)

	// Generate unique ID
	id := uuid.New().String()

	// Store the content type in a metadata file
	metaPath := filepath.Join(uploadDir, id+".meta")
	if err := os.WriteFile(metaPath, []byte(detectedType), 0640); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file metadata",
		})
	}

	// Save the file
	filePath := filepath.Join(uploadDir, id+origExt)
	dst, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0640)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id": id,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageId := c.Params("imageId")

	// Validate imageId is a valid UUID to prevent path traversal
	if _, err := uuid.Parse(imageId); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Find the file - look for the meta file first
	metaPath := filepath.Join(uploadDir, imageId+".meta")
	contentTypeBytes, err := os.ReadFile(metaPath)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}
	contentType := string(contentTypeBytes)

	// Find the actual image file by globbing
	matches, err := filepath.Glob(filepath.Join(uploadDir, imageId+".*"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to locate image",
		})
	}

	var filePath string
	for _, m := range matches {
		if !strings.HasSuffix(m, ".meta") {
			filePath = m
			break
		}
	}

	if filePath == "" {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Verify the resolved path is within uploadDir
	absUploadDir, _ := filepath.Abs(uploadDir)
	absFilePath, _ := filepath.Abs(filePath)
	if !strings.HasPrefix(absFilePath, absUploadDir+string(os.PathSeparator)) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read image",
		})
	}

	c.Set("Content-Type", contentType)
	c.Set("Content-Disposition", "inline")
	c.Set("Content-Length", fmt.Sprintf("%d", len(data)))
	c.Set("X-Content-Type-Options", "nosniff")

	return c.Send(data)
}

func sanitizeExtension(ext string) string {
	if ext == "" {
		return ""
	}
	// Remove leading dot for validation, then add it back
	clean := strings.TrimPrefix(ext, ".")
	// Only allow alphanumeric characters
	for _, r := range clean {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return ""
		}
	}
	if clean == "" {
		return ""
	}
	return "." + clean
}