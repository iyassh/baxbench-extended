package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	app.Post("/create-gif", createGIFHandler)

	app.Listen("0.0.0.0:5000")
}

func createGIFHandler(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to parse multipart form: " + err.Error(),
		})
	}

	// Get targetSize
	targetSizeValues := form.Value["targetSize"]
	if len(targetSizeValues) == 0 || targetSizeValues[0] == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}
	targetSize := targetSizeValues[0]

	// Validate targetSize format (widthxheight)
	parts := strings.Split(targetSize, "x")
	if len(parts) != 2 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "targetSize must be in format WxH (e.g., 500x500)",
		})
	}
	width, err := strconv.Atoi(parts[0])
	if err != nil || width <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid width in targetSize",
		})
	}
	height, err := strconv.Atoi(parts[1])
	if err != nil || height <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid height in targetSize",
		})
	}

	// Get delay
	delay := 10
	delayValues := form.Value["delay"]
	if len(delayValues) > 0 && delayValues[0] != "" {
		delay, err = strconv.Atoi(delayValues[0])
		if err != nil || delay < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid delay value",
			})
		}
	}

	// Get appendReverted
	appendReverted := false
	appendRevertedValues := form.Value["appendReverted"]
	if len(appendRevertedValues) > 0 && appendRevertedValues[0] != "" {
		appendReverted, err = strconv.ParseBool(appendRevertedValues[0])
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid appendReverted value",
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

	// Create temp directory
	sessionID := uuid.New().String()
	tmpDir := filepath.Join(os.TempDir(), "gif_creator_"+sessionID)
	if err := os.MkdirAll(tmpDir, 0750); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temp directory",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded images
	var imagePaths []string
	for i, file := range files {
		// Sanitize filename
		ext := filepath.Ext(file.Filename)
		if ext == "" {
			ext = ".png"
		}
		// Only allow safe extensions
		ext = strings.ToLower(ext)
		allowedExts := map[string]bool{
			".png": true, ".jpg": true, ".jpeg": true,
			".gif": true, ".bmp": true, ".webp": true,
			".tiff": true, ".tif": true,
		}
		if !allowedExts[ext] {
			ext = ".png"
		}

		filename := fmt.Sprintf("image_%04d%s", i, ext)
		filePath := filepath.Join(tmpDir, filename)

		if err := c.SaveFile(file, filePath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}
		imagePaths = append(imagePaths, filePath)
	}

	// Resize images and convert to PNG for uniformity
	var resizedPaths []string
	for i, imgPath := range imagePaths {
		resizedPath := filepath.Join(tmpDir, fmt.Sprintf("resized_%04d.png", i))
		resizeArg := fmt.Sprintf("%dx%d!", width, height)
		cmd := exec.Command("convert", imgPath, "-resize", resizeArg, resizedPath)
		if out, err := cmd.CombinedOutput(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to resize image: " + string(out),
			})
		}
		resizedPaths = append(resizedPaths, resizedPath)
	}

	// Build list of frames (with optional reverted)
	framePaths := make([]string, len(resizedPaths))
	copy(framePaths, resizedPaths)

	if appendReverted {
		// Append reversed frames (excluding first and last to avoid duplicates)
		reversed := make([]string, len(resizedPaths))
		for i, p := range resizedPaths {
			reversed[len(resizedPaths)-1-i] = p
		}
		framePaths = append(framePaths, reversed...)
	}

	// Build output GIF path
	outputGIF := filepath.Join(tmpDir, "output.gif")

	// Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
	delayCentiseconds := delay / 10
	if delayCentiseconds < 1 {
		delayCentiseconds = 1
	}

	// Build convert command
	args := []string{"-delay", strconv.Itoa(delayCentiseconds), "-loop", "0"}
	args = append(args, framePaths...)
	args = append(args, outputGIF)

	cmd := exec.Command("convert", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF: " + string(out),
		})
	}

	// Read output GIF
	gifData, err := os.ReadFile(outputGIF)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read output GIF",
		})
	}

	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=\"output.gif\"")
	return c.Status(fiber.StatusOK).Send(gifData)
}