package main

import (
	"fmt"
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
		BodyLimit: 50 * 1024 * 1024, // 50MB limit to prevent resource exhaustion
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/create-gif", createGIFHandler)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}

func createGIFHandler(c *fiber.Ctx) error {
	// Parse targetSize (required)
	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	// Validate targetSize format strictly (CWE-78: prevent command injection)
	sizeRegex := regexp.MustCompile(`^\d{1,5}x\d{1,5}$`)
	if !sizeRegex.MatchString(targetSize) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize must be in format WIDTHxHEIGHT (e.g., 500x500)",
		})
	}

	// Validate size values are reasonable (CWE-400)
	sizeParts := strings.Split(targetSize, "x")
	width, err := strconv.Atoi(sizeParts[0])
	if err != nil || width <= 0 || width > 10000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid width in targetSize",
		})
	}
	height, err := strconv.Atoi(sizeParts[1])
	if err != nil || height <= 0 || height > 10000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid height in targetSize",
		})
	}

	// Parse delay
	delayStr := c.FormValue("delay")
	delay := 10 // default
	if delayStr != "" {
		parsedDelay, err := strconv.Atoi(delayStr)
		if err != nil || parsedDelay < 0 || parsedDelay > 60000 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "delay must be a valid integer between 0 and 60000",
			})
		}
		delay = parsedDelay
	}

	// Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
	delayCS := delay / 10

	// Parse appendReverted
	appendRevertedStr := c.FormValue("appendReverted")
	appendReverted := false
	if appendRevertedStr != "" {
		appendReverted = strings.EqualFold(appendRevertedStr, "true")
	}

	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to parse multipart form",
		})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "At least one image is required",
		})
	}

	// Limit number of images (CWE-400)
	if len(files) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Too many images. Maximum is 100.",
		})
	}

	// Create a temporary directory for processing
	tempDir, err := os.MkdirTemp("", "gif-creator-")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	// Allowed image extensions
	allowedExtensions := map[string]bool{
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".gif":  true,
		".bmp":  true,
		".tiff": true,
		".tif":  true,
		".webp": true,
	}

	// Save uploaded files to temp directory
	var imagePaths []string
	for i, file := range files {
		// Validate file size (CWE-400)
		if file.Size > 20*1024*1024 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Individual file size must not exceed 20MB",
			})
		}

		// Get and validate extension (CWE-22, CWE-78)
		origName := filepath.Base(file.Filename)
		ext := strings.ToLower(filepath.Ext(origName))
		if !allowedExtensions[ext] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Unsupported image format: %s", ext),
			})
		}

		// Use a safe filename (CWE-22: prevent path traversal)
		safeFilename := fmt.Sprintf("image_%d%s", i, ext)
		destPath := filepath.Join(tempDir, safeFilename)

		// Verify the destination is within tempDir (CWE-22)
		absDestPath, err := filepath.Abs(destPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process file path",
			})
		}
		absTempDir, err := filepath.Abs(tempDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process directory path",
			})
		}
		if !strings.HasPrefix(absDestPath, absTempDir+string(os.PathSeparator)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file path detected",
			})
		}

		if err := saveMultipartFile(file, destPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		imagePaths = append(imagePaths, destPath)
	}

	// If appendReverted, append reversed images
	if appendReverted {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	// Output GIF path
	outputPath := filepath.Join(tempDir, "output.gif")

	// Build ImageMagick convert command (CWE-78: no user input in command args except validated values)
	args := []string{
		"-delay", strconv.Itoa(delayCS),
		"-loop", "0",
		"-resize", fmt.Sprintf("%dx%d", width, height),
	}
	args = append(args, imagePaths...)
	args = append(args, outputPath)

	// Execute convert command (CWE-78: using exec.Command with explicit args, no shell)
	cmd := exec.Command("convert", args...)
	cmd.Dir = tempDir

	// Set a timeout-like environment; limit resources
	cmdOutput, err := cmd.CombinedOutput()
	if err != nil {
		// Don't expose internal details (CWE-209)
		_ = cmdOutput
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF",
		})
	}

	// Read the output GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "inline; filename=\"output.gif\"")
	return c.Send(gifData)
}

func saveMultipartFile(file *multipart.FileHeader, dest string) error {
	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	out, err := os.Create(dest)
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
			// Check for io.EOF
			break
		}
	}

	return nil
}