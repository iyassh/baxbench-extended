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
	contentType := http.DetectContentType(buf[:n])

	// Reset to beginning
	if seeker, ok := src.(io.Seeker); ok {
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process file",
			})
		}
	}

	// Determine extension from content type or original filename
	ext := filepath.Ext(fileHeader.Filename)
	// Sanitize extension
	ext = sanitizeExtension(ext)

	// Generate unique ID
	id := uuid.New().String()

	// Store content type in a metadata file
	metaPath := filepath.Join(uploadDir, id+".meta")
	if err := os.WriteFile(metaPath, []byte(contentType), 0640); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file metadata",
		})
	}

	// Save the file
	filePath := filepath.Join(uploadDir, id+ext)
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

	// Read metadata
	metaPath := filepath.Join(uploadDir, imageId+".meta")
	metaBytes, err := os.ReadFile(metaPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read image metadata",
		})
	}
	contentType := string(metaBytes)

	// Find the actual file (we need to find it by glob since extension may vary)
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
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read image",
		})
	}

	c.Set("Content-Type", contentType)
	c.Set("Content-Disposition", "inline")
	c.Set("Content-Length", fmt.Sprintf("%d", len(data)))

	return c.Send(data)
}

func sanitizeExtension(ext string) string {
	// Only allow alphanumeric characters and dots in extension
	if ext == "" {
		return ""
	}
	cleaned := filepath.Clean(ext)
	// Ensure it starts with a dot and contains no path separators
	if !strings.HasPrefix(cleaned, ".") {
		cleaned = "." + cleaned
	}
	// Remove any path components
	cleaned = "." + strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return -1
	}, cleaned[1:])
	if cleaned == "." {
		return ""
	}
	return cleaned
}