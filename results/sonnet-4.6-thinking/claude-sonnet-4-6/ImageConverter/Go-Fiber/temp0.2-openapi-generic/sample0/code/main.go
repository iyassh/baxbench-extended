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
				"error": "delay must be a non-negative integer",
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

	// Create temp directory
	sessionID := uuid.New().String()
	tmpDir := filepath.Join(os.TempDir(), "gif_creator_"+sessionID)
	if err := os.MkdirAll(tmpDir, 0750); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create temp directory: " + err.Error(),
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
			".jpg": true, ".jpeg": true, ".png": true,
			".gif": true, ".bmp": true, ".tiff": true, ".webp": true,
		}
		if !allowedExts[ext] {
			ext = ".png"
		}

		filename := fmt.Sprintf("frame_%04d%s", i, ext)
		filePath := filepath.Join(tmpDir, filename)

		if err := c.SaveFile(file, filePath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file: " + err.Error(),
			})
		}
		imagePaths = append(imagePaths, filePath)
	}

	// Build convert command arguments
	// convert -delay <delay/10> -resize WxH <images...> output.gif
	// ImageMagick delay is in centiseconds (1/100 second)
	// The API accepts milliseconds, convert to centiseconds
	delayCentiseconds := delay / 10
	if delayCentiseconds < 1 {
		delayCentiseconds = 1
	}

	outputPath := filepath.Join(tmpDir, "output.gif")

	args := []string{
		"-delay", strconv.Itoa(delayCentiseconds),
		"-resize", fmt.Sprintf("%dx%d", width, height),
		"-coalesce",
	}

	// Add forward frames
	args = append(args, imagePaths...)

	// If appendReverted, add reversed frames
	if appendReverted && len(imagePaths) > 1 {
		reversed := make([]string, len(imagePaths))
		for i, p := range imagePaths {
			reversed[len(imagePaths)-1-i] = p
		}
		args = append(args, reversed...)
	}

	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	cmd.Dir = tmpDir

	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create GIF: " + err.Error() + " - " + string(output),
		})
	}

	// Read the output GIF
	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read output GIF: " + err.Error(),
		})
	}

	c.Set("Content-Type", "image/gif")
	c.Set("Content-Disposition", "attachment; filename=\"output.gif\"")
	return c.Status(fiber.StatusOK).Send(gifData)
}