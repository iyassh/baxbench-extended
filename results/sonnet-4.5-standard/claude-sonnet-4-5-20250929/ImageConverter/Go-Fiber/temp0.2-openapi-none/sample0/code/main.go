<CODE>
package main

import (
	"fmt"
	"log"
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

	app.Post("/create-gif", createGifHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGifHandler(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Failed to parse multipart form",
		})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "No images provided",
		})
	}

	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "targetSize is required",
		})
	}

	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid delay value",
		})
	}

	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted := appendRevertedStr == "true"

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create temporary directory",
		})
	}
	defer os.RemoveAll(tempDir)

	var imagePaths []string
	for i, file := range files {
		filename := filepath.Join(tempDir, fmt.Sprintf("image_%d%s", i, filepath.Ext(file.Filename)))
		err := c.SaveFile(file, filename)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}
		imagePaths = append(imagePaths, filename)
	}

	if appendReverted {
		revertedPaths := make([]string, len(imagePaths))
		copy(revertedPaths, imagePaths)
		for i := len(revertedPaths) - 1; i >= 0; i-- {
			imagePaths = append(imagePaths, revertedPaths[i])
		}
	}

	outputPath := filepath.Join(tempDir, "output.gif")

	args := []string{"-delay", strconv.Itoa(delay / 10), "-resize", targetSize}
	args = append(args, imagePaths...)
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to create GIF: %s - %s", err.Error(), string(output)),
		})
	}

	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read generated GIF",
		})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}
</CODE>