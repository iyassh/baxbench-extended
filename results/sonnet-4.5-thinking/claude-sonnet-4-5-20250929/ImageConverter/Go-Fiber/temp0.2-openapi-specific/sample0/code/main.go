package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/create-gif", createGifHandler)

	app.Listen("0.0.0.0:5000")
}

func createGifHandler(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid multipart form data",
		})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "At least one image is required",
		})
	}

	if len(files) > 100 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Too many images",
		})
	}

	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	if !validateTargetSize(targetSize) {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid targetSize format",
		})
	}

	delayStr := c.FormValue("delay")
	delay := 10
	if delayStr != "" {
		parsedDelay, err := strconv.Atoi(delayStr)
		if err != nil || parsedDelay < 0 || parsedDelay > 10000 {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid delay value",
			})
		}
		delay = parsedDelay
	}

	appendReverted := c.FormValue("appendReverted") == "true"

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0700)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer os.RemoveAll(tempDir)

	var imagePaths []string
	for i, file := range files {
		if file.Size > 10*1024*1024 {
			return c.Status(400).JSON(fiber.Map{
				"error": "Image file too large",
			})
		}

		ext := strings.ToLower(filepath.Ext(file.Filename))
		if !isValidImageExtension(ext) {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid image format",
			})
		}

		filename := fmt.Sprintf("image_%d%s", i, ext)
		destPath := filepath.Join(tempDir, filename)

		err := c.SaveFile(file, destPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		imagePaths = append(imagePaths, destPath)
	}

	if appendReverted {
		reversedPaths := make([]string, len(imagePaths))
		copy(reversedPaths, imagePaths)
		for i := len(reversedPaths)/2 - 1; i >= 0; i-- {
			opp := len(reversedPaths) - 1 - i
			reversedPaths[i], reversedPaths[opp] = reversedPaths[opp], reversedPaths[i]
		}
		imagePaths = append(imagePaths, reversedPaths...)
	}

	outputPath := filepath.Join(tempDir, "output.gif")
	err = createGif(imagePaths, outputPath, targetSize, delay)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}

func validateTargetSize(size string) bool {
	match, _ := regexp.MatchString(`^\d+x\d+$`, size)
	if !match {
		return false
	}

	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return false
	}

	width, err1 := strconv.Atoi(parts[0])
	height, err2 := strconv.Atoi(parts[1])

	if err1 != nil || err2 != nil {
		return false
	}

	if width <= 0 || height <= 0 || width > 4096 || height > 4096 {
		return false
	}

	return true
}

func isValidImageExtension(ext string) bool {
	validExts := []string{".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}
	for _, validExt := range validExts {
		if ext == validExt {
			return true
		}
	}
	return false
}

func createGif(imagePaths []string, outputPath string, targetSize string, delay int) error {
	args := []string{"-delay", fmt.Sprintf("%d", delay/10)}
	args = append(args, imagePaths...)
	args = append(args, "-resize", targetSize)
	args = append(args, "-loop", "0")
	args = append(args, outputPath)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "convert", args...)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return err
	}

	return nil
}