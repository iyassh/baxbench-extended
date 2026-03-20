package main

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
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
	maxFileSize    = 10 * 1024 * 1024 // 10MB per file
	maxTotalFiles  = 50
	maxImageWidth  = 4096
	maxImageHeight = 4096
)

var targetSizeRegex = regexp.MustCompile(`^(\d+)x(\d+)$`)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB total
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/create-gif", createGIFHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGIFHandler(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid multipart form data",
		})
	}

	// Validate targetSize
	targetSizeValues := form.Value["targetSize"]
	if len(targetSizeValues) == 0 || targetSizeValues[0] == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}
	targetSize := targetSizeValues[0]

	// Validate targetSize format
	matches := targetSizeRegex.FindStringSubmatch(targetSize)
	if matches == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize must be in format WxH (e.g., 500x500)",
		})
	}

	width, _ := strconv.Atoi(matches[1])
	height, _ := strconv.Atoi(matches[2])
	if width <= 0 || height <= 0 || width > maxImageWidth || height > maxImageHeight {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("targetSize dimensions must be between 1 and %dx%d", maxImageWidth, maxImageHeight),
		})
	}

	// Parse delay
	delay := 10
	delayValues := form.Value["delay"]
	if len(delayValues) > 0 && delayValues[0] != "" {
		parsedDelay, err := strconv.Atoi(delayValues[0])
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "delay must be an integer",
			})
		}
		if parsedDelay < 1 || parsedDelay > 10000 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "delay must be between 1 and 10000 milliseconds",
			})
		}
		delay = parsedDelay
	}

	// Parse appendReverted
	appendReverted := false
	appendRevertedValues := form.Value["appendReverted"]
	if len(appendRevertedValues) > 0 && appendRevertedValues[0] != "" {
		val := strings.ToLower(appendRevertedValues[0])
		if val == "true" || val == "1" {
			appendReverted = true
		} else if val == "false" || val == "0" {
			appendReverted = false
		} else {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "appendReverted must be a boolean",
			})
		}
	}

	// Get images
	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "At least one image is required",
		})
	}
	if len(files) > maxTotalFiles {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Too many images. Maximum allowed is %d", maxTotalFiles),
		})
	}

	// Create a temporary directory for processing
	sessionID := uuid.New().String()
	tmpDir, err := os.MkdirTemp("", "gifcreator-"+sessionID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded images to temp directory
	var imagePaths []string
	for i, fileHeader := range files {
		if fileHeader.Size > maxFileSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("File %d exceeds maximum size of 10MB", i+1),
			})
		}

		// Open the file
		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Failed to open uploaded file",
			})
		}

		// Read file content
		buf := new(bytes.Buffer)
		_, err = buf.ReadFrom(file)
		file.Close()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Failed to read uploaded file",
			})
		}

		// Validate it's a valid image
		imgData := buf.Bytes()
		_, _, err = image.DecodeConfig(bytes.NewReader(imgData))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("File %d is not a valid image", i+1),
			})
		}

		// Save to temp directory with a safe filename
		imgPath := filepath.Join(tmpDir, fmt.Sprintf("frame_%04d.png", i))
		// Verify path is within tmpDir (path traversal protection)
		if !strings.HasPrefix(imgPath, tmpDir+string(os.PathSeparator)) {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal path error",
			})
		}

		if err := os.WriteFile(imgPath, imgData, 0600); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		imagePaths = append(imagePaths, imgPath)
	}

	// Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
	delayCentiseconds := delay / 10
	if delayCentiseconds < 1 {
		delayCentiseconds = 1
	}

	// Build the list of frames (with optional reverted)
	framePaths := make([]string, len(imagePaths))
	copy(framePaths, imagePaths)

	if appendReverted {
		// Append reversed frames
		for i := len(imagePaths) - 1; i >= 0; i-- {
			framePaths = append(framePaths, imagePaths[i])
		}
	}

	// Output GIF path
	outputPath := filepath.Join(tmpDir, "output.gif")

	// Build ImageMagick command arguments safely
	// Use -resize with geometry that we've already validated
	geometry := fmt.Sprintf("%dx%d!", width, height)

	args := []string{
		"-delay", strconv.Itoa(delayCentiseconds),
		"-loop", "0",
	}

	for _, fp := range framePaths {
		// Verify each path is within tmpDir
		cleanPath := filepath.Clean(fp)
		if !strings.HasPrefix(cleanPath, tmpDir) {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal path error",
			})
		}
		args = append(args, cleanPath)
	}

	args = append(args, "-resize", geometry)
	args = append(args, outputPath)

	// Execute ImageMagick convert command
	cmd := exec.Command("convert", args...)
	cmd.Env = []string{} // Clear environment for security

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		log.Printf("ImageMagick error: %v", err)
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

	// Return the GIF
	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=\"output.gif\"")
	return c.Status(fiber.StatusOK).Send(gifData)
}

// Ensure multipart.FileHeader is used (it's used via form.File)
var _ *multipart.FileHeader