package main

import (
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New()

	app.Use(cors.New())

	app.Post("/create-gif", createGIF)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGIF(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "Failed to parse multipart form"})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(ErrorResponse{Error: "No images provided"})
	}

	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "targetSize is required"})
	}

	if !isValidSize(targetSize) {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid targetSize format. Expected format: WIDTHxHEIGHT"})
	}

	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 0 {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid delay value"})
	}

	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted := appendRevertedStr == "true"

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary directory"})
	}
	defer os.RemoveAll(tempDir)

	var imagePaths []string

	for i, file := range files {
		if !isValidImageType(file.Header.Get("Content-Type")) {
			return c.Status(400).JSON(ErrorResponse{Error: fmt.Sprintf("Invalid image type for file %d", i)})
		}

		filename := fmt.Sprintf("image_%d%s", i, getFileExtension(file.Filename))
		imagePath := filepath.Join(tempDir, filename)

		err := saveUploadedFile(file, imagePath)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to save uploaded file"})
		}

		imagePaths = append(imagePaths, imagePath)
	}

	if appendReverted {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	outputPath := filepath.Join(tempDir, "output.gif")
	err = createGIFFromImages(imagePaths, outputPath, targetSize, delay)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: fmt.Sprintf("Failed to create GIF: %v", err)})
	}

	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Failed to read generated GIF"})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}

func isValidSize(size string) bool {
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return false
	}

	width, err1 := strconv.Atoi(parts[0])
	height, err2 := strconv.Atoi(parts[1])

	return err1 == nil && err2 == nil && width > 0 && height > 0
}

func isValidImageType(contentType string) bool {
	validTypes := []string{
		"image/jpeg",
		"image/jpg",
		"image/png",
		"image/gif",
		"image/bmp",
		"image/webp",
	}

	for _, validType := range validTypes {
		if contentType == validType {
			return true
		}
	}
	return false
}

func getFileExtension(filename string) string {
	ext := filepath.Ext(filename)
	if ext == "" {
		return ".jpg"
	}
	return ext
}

func saveUploadedFile(file *multipart.FileHeader, dst string) error {
	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, src)
	return err
}

func createGIFFromImages(imagePaths []string, outputPath, targetSize string, delay int) error {
	args := []string{
		"-delay", fmt.Sprintf("%d", delay/10),
		"-loop", "0",
		"-resize", targetSize,
	}

	args = append(args, imagePaths...)
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("imagemagick error: %v, output: %s", err, string(output))
	}

	return nil
}