package main

import (
	"fmt"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB
	})

	app.Post("/create-gif", createGifHandler)

	app.Listen("0.0.0.0:5000")
}

func createGifHandler(c *fiber.Ctx) error {
	// Parse targetSize
	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(fiber.Map{"error": "targetSize is required"})
	}

	// Validate targetSize format (WxH)
	parts := strings.Split(targetSize, "x")
	if len(parts) != 2 {
		return c.Status(400).JSON(fiber.Map{"error": "targetSize must be in format WxH (e.g., 500x500)"})
	}
	width, err := strconv.Atoi(parts[0])
	if err != nil || width <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "invalid width in targetSize"})
	}
	height, err := strconv.Atoi(parts[1])
	if err != nil || height <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "invalid height in targetSize"})
	}

	// Parse delay
	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 0 {
		return c.Status(400).JSON(fiber.Map{"error": "invalid delay value"})
	}
	// Convert milliseconds to centiseconds for ImageMagick
	delayCentiseconds := delay / 10
	if delayCentiseconds < 1 {
		delayCentiseconds = 1
	}

	// Parse appendReverted
	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted := appendRevertedStr == "true" || appendRevertedStr == "1"

	// Get uploaded images
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "failed to parse multipart form"})
	}

	files := form.File["images"]
	if len(files) == 0 {
		// Try singular form field name as well
		files = form.File["images[]"]
	}
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "images are required"})
	}

	// Create a temporary directory for processing
	tmpDir, err := os.MkdirTemp("", "gif-creator-"+uuid.New().String())
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to create temporary directory"})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded files to temp directory
	var imagePaths []string
	for i, file := range files {
		// Validate file extension
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if !isValidImageExt(ext) {
			return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("unsupported image format: %s", ext)})
		}

		// Sanitize: use index-based naming to avoid path traversal
		savePath := filepath.Join(tmpDir, fmt.Sprintf("image_%d%s", i, ext))
		if err := saveMultipartFile(file, savePath); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "failed to save uploaded image"})
		}
		imagePaths = append(imagePaths, savePath)
	}

	// Build the list of images for the GIF
	var allImages []string
	allImages = append(allImages, imagePaths...)

	if appendReverted {
		// Append images in reverse order
		for i := len(imagePaths) - 1; i >= 0; i-- {
			allImages = append(allImages, imagePaths[i])
		}
	}

	// Build ImageMagick convert command
	outputPath := filepath.Join(tmpDir, "output.gif")

	args := []string{
		"-delay", strconv.Itoa(delayCentiseconds),
		"-resize", fmt.Sprintf("%dx%d!", width, height),
		"-loop", "0",
	}
	args = append(args, allImages...)
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	cmdOutput, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": fmt.Sprintf("failed to create GIF: %s", string(cmdOutput))})
	}

	// Read the output GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to read generated GIF"})
	}

	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "inline; filename=\"output.gif\"")
	return c.Send(gifData)
}

func isValidImageExt(ext string) bool {
	validExts := map[string]bool{
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".gif":  true,
		".bmp":  true,
		".tiff": true,
		".tif":  true,
		".webp": true,
	}
	return validExts[ext]
}

func saveMultipartFile(file *multipart.FileHeader, dst string) error {
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

	buf := make([]byte, 32*1024)
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			if _, writeErr := out.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
		}
		if readErr != nil {
			if readErr.Error() == "EOF" {
				break
			}
			return readErr
		}
	}
	return nil
}