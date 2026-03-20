package main

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB total limit
	})

	app.Post("/create-gif", createGIF)

	app.Listen("0.0.0.0:5000")
}

func createGIF(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Failed to parse multipart form",
		})
	}

	// Get images
	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "No images provided",
		})
	}

	if len(files) > 100 { // Reasonable limit
		return c.Status(400).JSON(fiber.Map{
			"error": "Too many images provided (max 100)",
		})
	}

	// Get targetSize
	targetSizes := form.Value["targetSize"]
	if len(targetSizes) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}
	targetSize := strings.TrimSpace(targetSizes[0])

	// Validate targetSize format
	if !isValidTargetSize(targetSize) {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid targetSize format. Expected format: WIDTHxHEIGHT (e.g., 500x500)",
		})
	}

	// Get delay (default 10)
	delay := 10
	if delayValues := form.Value["delay"]; len(delayValues) > 0 {
		if d, err := strconv.Atoi(strings.TrimSpace(delayValues[0])); err == nil && d > 0 && d <= 10000 {
			delay = d
		} else if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid delay value. Must be a positive integer.",
			})
		}
	}

	// Get appendReverted (default false)
	appendReverted := false
	if appendValues := form.Value["appendReverted"]; len(appendValues) > 0 {
		val := strings.ToLower(strings.TrimSpace(appendValues[0]))
		appendReverted = val == "true" || val == "1"
	}

	// Create temporary directory
	tempDir := filepath.Join(os.TempDir(), fmt.Sprintf("gif-%s", uuid.New().String()))
	err = os.MkdirAll(tempDir, 0700)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save uploaded files
	var imagePaths []string
	for i, file := range files {
		if !isValidImageFile(file) {
			return c.Status(400).JSON(fiber.Map{
				"error": fmt.Sprintf("Invalid image file: %s", file.Filename),
			})
		}

		// Use safe filename
		ext := filepath.Ext(file.Filename)
		safeName := fmt.Sprintf("image_%d%s", i, ext)
		imagePath := filepath.Join(tempDir, safeName)

		err = saveUploadedFile(file, imagePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}
		imagePaths = append(imagePaths, imagePath)
	}

	// Create GIF
	gifPath := filepath.Join(tempDir, "output.gif")
	err = createGIFFromImages(imagePaths, gifPath, targetSize, delay, appendReverted)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to create GIF: %s", err.Error()),
		})
	}

	// Read and return GIF
	gifData, err := os.ReadFile(gifPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}

func isValidTargetSize(targetSize string) bool {
	// Validate format like "500x500"
	re := regexp.MustCompile(`^(\d+)x(\d+)$`)
	matches := re.FindStringSubmatch(targetSize)
	if len(matches) != 3 {
		return false
	}

	// Check reasonable size limits
	width, _ := strconv.Atoi(matches[1])
	height, _ := strconv.Atoi(matches[2])

	return width > 0 && width <= 2000 && height > 0 && height <= 2000
}

func isValidImageFile(file *multipart.FileHeader) bool {
	// Check file size (max 10MB per file)
	if file.Size > 10*1024*1024 || file.Size == 0 {
		return false
	}

	// Check filename is not empty or suspicious
	if strings.TrimSpace(file.Filename) == "" {
		return false
	}

	// Check file extension
	ext := strings.ToLower(filepath.Ext(file.Filename))
	validExts := []string{".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp"}
	for _, validExt := range validExts {
		if ext == validExt {
			return true
		}
	}
	return false
}

func saveUploadedFile(file *multipart.FileHeader, destPath string) error {
	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	return err
}

func createGIFFromImages(imagePaths []string, outputPath, targetSize string, delay int, appendReverted bool) error {
	// Convert delay from milliseconds to centiseconds (1/100 second)
	delayCs := delay / 10
	if delayCs < 1 {
		delayCs = 1
	}

	// Build list of images including reverted if requested
	var allImages []string
	allImages = append(allImages, imagePaths...)

	if appendReverted {
		for i := len(imagePaths) - 1; i >= 0; i-- {
			allImages = append(allImages, imagePaths[i])
		}
	}

	// Prepare command arguments
	args := []string{
		"-delay", fmt.Sprintf("%d", delayCs),
		"-resize", targetSize,
	}

	// Add all images
	args = append(args, allImages...)

	// Add loop and output
	args = append(args, "-loop", "0", outputPath)

	// Execute convert command
	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("imagemagick convert failed: %s (output: %s)", err.Error(), string(output))
	}

	// Verify output file was created
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return fmt.Errorf("output GIF file was not created")
	}

	return nil
}