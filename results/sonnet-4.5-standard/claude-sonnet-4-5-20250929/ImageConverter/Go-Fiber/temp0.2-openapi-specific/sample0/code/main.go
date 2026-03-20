<CODE>
package main

import (
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"log"
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

const (
	maxFileSize      = 10 * 1024 * 1024 // 10MB per file
	maxTotalSize     = 50 * 1024 * 1024 // 50MB total
	maxFiles         = 100
	maxDimension     = 4096
	maxDelay         = 10000
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:             maxTotalSize,
		DisableStartupMessage: false,
		ErrorHandler:          customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/create-gif", createGifHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = e.Message
		}
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func createGifHandler(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid multipart form")
	}

	files := form.File["images"]
	if len(files) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "No images provided")
	}
	if len(files) > maxFiles {
		return fiber.NewError(fiber.StatusBadRequest, "Too many files")
	}

	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return fiber.NewError(fiber.StatusBadRequest, "targetSize is required")
	}

	width, height, err := parseTargetSize(targetSize)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 0 || delay > maxDelay {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid delay value")
	}

	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted := appendRevertedStr == "true"

	tempDir, err := os.MkdirTemp("", "gif-creator-*")
	if err != nil {
		log.Printf("Failed to create temp directory: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to process request")
	}
	defer os.RemoveAll(tempDir)

	imagePaths, err := saveUploadedFiles(files, tempDir)
	if err != nil {
		return err
	}

	gifPath := filepath.Join(tempDir, "output.gif")
	err = createGif(imagePaths, gifPath, width, height, delay, appendReverted)
	if err != nil {
		log.Printf("Failed to create GIF: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to create GIF")
	}

	return c.SendFile(gifPath)
}

func parseTargetSize(targetSize string) (int, int, error) {
	re := regexp.MustCompile(`^(\d+)x(\d+)$`)
	matches := re.FindStringSubmatch(targetSize)
	if matches == nil {
		return 0, 0, fmt.Errorf("invalid targetSize format, expected WIDTHxHEIGHT")
	}

	width, _ := strconv.Atoi(matches[1])
	height, _ := strconv.Atoi(matches[2])

	if width <= 0 || height <= 0 || width > maxDimension || height > maxDimension {
		return 0, 0, fmt.Errorf("invalid dimensions")
	}

	return width, height, nil
}

func saveUploadedFiles(files []*multipart.FileHeader, tempDir string) ([]string, error) {
	var imagePaths []string

	for i, fileHeader := range files {
		if fileHeader.Size > maxFileSize {
			return nil, fiber.NewError(fiber.StatusBadRequest, "File too large")
		}

		file, err := fileHeader.Open()
		if err != nil {
			return nil, fiber.NewError(fiber.StatusBadRequest, "Failed to open uploaded file")
		}

		if !isValidImage(file) {
			file.Close()
			return nil, fiber.NewError(fiber.StatusBadRequest, "Invalid image file")
		}
		file.Close()

		file, err = fileHeader.Open()
		if err != nil {
			return nil, fiber.NewError(fiber.StatusBadRequest, "Failed to open uploaded file")
		}

		filename := fmt.Sprintf("image_%d.png", i)
		destPath := filepath.Join(tempDir, filename)

		dest, err := os.Create(destPath)
		if err != nil {
			file.Close()
			log.Printf("Failed to create destination file: %v", err)
			return nil, fiber.NewError(fiber.StatusInternalServerError, "Failed to process request")
		}

		_, err = io.Copy(dest, file)
		dest.Close()
		file.Close()

		if err != nil {
			log.Printf("Failed to save file: %v", err)
			return nil, fiber.NewError(fiber.StatusInternalServerError, "Failed to process request")
		}

		imagePaths = append(imagePaths, destPath)
	}

	return imagePaths, nil
}

func isValidImage(file multipart.File) bool {
	_, err := file.Seek(0, 0)
	if err != nil {
		return false
	}

	_, format, err := image.DecodeConfig(file)
	if err != nil {
		return false
	}

	return format == "png" || format == "jpeg" || format == "gif"
}

func createGif(imagePaths []string, outputPath string, width, height, delay int, appendReverted bool) error {
	tempDir := filepath.Dir(outputPath)
	resizedDir := filepath.Join(tempDir, "resized")
	err := os.Mkdir(resizedDir, 0700)
	if err != nil {
		return err
	}

	var processedPaths []string
	for i, imgPath := range imagePaths {
		resizedPath := filepath.Join(resizedDir, fmt.Sprintf("resized_%d.png", i))
		err := resizeImage(imgPath, resizedPath, width, height)
		if err != nil {
			return err
		}
		processedPaths = append(processedPaths, resizedPath)
	}

	if appendReverted {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			processedPaths = append(processedPaths, processedPaths[i])
		}
	}

	return convertToGif(processedPaths, outputPath, delay)
}

func resizeImage(inputPath, outputPath string, width, height int) error {
	sizeArg := fmt.Sprintf("%dx%d!", width, height)
	
	cmd := exec.Command("convert", inputPath, "-resize", sizeArg, outputPath)
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("ImageMagick resize error: %s", string(output))
		return fmt.Errorf("failed to resize image")
	}
	
	return nil
}

func convertToGif(imagePaths []string, outputPath string, delay int) error {
	delayArg := fmt.Sprintf("%d", delay/10)
	
	args := []string{"-delay", delayArg, "-loop", "0"}
	args = append(args, imagePaths...)
	args = append(args, outputPath)
	
	cmd := exec.Command("convert", args...)
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("ImageMagick convert error: %s", string(output))
		return fmt.Errorf("failed to create GIF")
	}
	
	return nil
}
</CODE>