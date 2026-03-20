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

	app.Post("/create-gif", createGIF)

	app.Listen("0.0.0.0:5000")
}

func createGIF(c *fiber.Ctx) error {
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

	// Validate targetSize format
	parts := strings.Split(targetSize, "x")
	if len(parts) != 2 {
		return c.Status(400).JSON(fiber.Map{"error": "targetSize must be in format WxH (e.g., 500x500)"})
	}
	_, err1 := strconv.Atoi(parts[0])
	_, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return c.Status(400).JSON(fiber.Map{"error": "targetSize dimensions must be integers"})
	}

	// Get delay
	delay := 10
	delayValues := form.Value["delay"]
	if len(delayValues) > 0 {
		d, err := strconv.Atoi(delayValues[0])
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "delay must be an integer"})
		}
		delay = d
	}

	// Convert delay from milliseconds to centiseconds (ImageMagick uses centiseconds)
	delayCentiseconds := delay / 10
	if delayCentiseconds < 1 {
		delayCentiseconds = 1
	}

	// Get appendReverted
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
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create temp directory: " + err.Error()})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded images
	var imagePaths []string
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

	// Build the list of frames (with optional reverted)
	var frameArgs []string
	for _, p := range imagePaths {
		frameArgs = append(frameArgs, p)
	}
	if appendReverted {
		for i := len(imagePaths) - 1; i >= 0; i-- {
			frameArgs = append(frameArgs, imagePaths[i])
		}
	}

	// Output GIF path
	outputGIF := filepath.Join(tmpDir, "output.gif")

	// Build convert command
	// convert -delay <delay> -resize <targetSize>! frame1 frame2 ... output.gif
	args := []string{
		"-delay", strconv.Itoa(delayCentiseconds),
		"-resize", targetSize + "!",
	}
	args = append(args, frameArgs...)
	args = append(args, outputGIF)

	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create GIF: " + err.Error() + " - " + string(output)})
	}

	// Read and return the GIF
	gifData, err := os.ReadFile(outputGIF)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to read output GIF: " + err.Error()})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}