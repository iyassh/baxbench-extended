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
		return c.Status(400).JSON(fiber.Map{"error": "Failed to parse multipart form: " + err.Error()})
	}

	// Get targetSize
	targetSizeValues := form.Value["targetSize"]
	if len(targetSizeValues) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "targetSize is required"})
	}
	targetSize := targetSizeValues[0]

	// Validate targetSize format (widthxheight)
	parts := strings.Split(targetSize, "x")
	if len(parts) != 2 {
		return c.Status(400).JSON(fiber.Map{"error": "targetSize must be in format WxH (e.g., 500x500)"})
	}
	_, err = strconv.Atoi(parts[0])
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid width in targetSize"})
	}
	_, err = strconv.Atoi(parts[1])
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid height in targetSize"})
	}

	// Get delay (default 10)
	delay := 10
	delayValues := form.Value["delay"]
	if len(delayValues) > 0 && delayValues[0] != "" {
		delay, err = strconv.Atoi(delayValues[0])
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "delay must be an integer"})
		}
	}

	// Get appendReverted (default false)
	appendReverted := false
	appendRevertedValues := form.Value["appendReverted"]
	if len(appendRevertedValues) > 0 {
		val := strings.ToLower(appendRevertedValues[0])
		if val == "true" || val == "1" {
			appendReverted = true
		}
	}

	// Get images
	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "images are required"})
	}

	// Create temp directory
	tmpDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tmpDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp directory: " + err.Error()})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded images
	imagePaths := []string{}
	for i, file := range files {
		ext := filepath.Ext(file.Filename)
		if ext == "" {
			ext = ".png"
		}
		imgPath := filepath.Join(tmpDir, fmt.Sprintf("frame_%04d%s", i, ext))
		if err := c.SaveFile(file, imgPath); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to save image: " + err.Error()})
		}
		imagePaths = append(imagePaths, imgPath)
	}

	// Build convert command arguments
	// convert -delay <delay> -resize <targetSize> frame1 frame2 ... output.gif
	outputGIF := filepath.Join(tmpDir, "output.gif")

	args := []string{}
	args = append(args, "-delay", strconv.Itoa(delay))
	args = append(args, "-resize", targetSize)
	args = append(args, "-loop", "0")

	for _, p := range imagePaths {
		args = append(args, p)
	}

	if appendReverted {
		// Append images in reverse order
		for i := len(imagePaths) - 1; i >= 0; i-- {
			args = append(args, imagePaths[i])
		}
	}

	args = append(args, outputGIF)

	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create GIF: " + err.Error() + " | Output: " + string(output)})
	}

	// Read output GIF
	gifData, err := os.ReadFile(outputGIF)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to read output GIF: " + err.Error()})
	}

	c.Set("Content-Type", "image/gif")
	return c.Status(200).Send(gifData)
}