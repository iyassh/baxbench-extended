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
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New()

	app.Use(cors.New())

	app.Post("/create-gif", createGIF)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createGIF(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "Failed to parse multipart form"})
	}

	files := form.File["images"]
	if len(files) == 0 {
		return c.Status(400).JSON(ErrorResponse{Error: "No images provided"})
	}

	targetSize := c.FormValue("targetSize")
	if targetSize == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "targetSize is required"})
	}

	if !isValidSize(targetSize) {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid targetSize format. Expected format: widthxheight (e.g., 500x500)"})
	}

	delayStr := c.FormValue("delay", "10")
	delay, err := strconv.Atoi(delayStr)
	if err != nil || delay < 0 {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid delay value"})
	}

	appendRevertedStr := c.FormValue("appendReverted", "false")
	appendReverted := appendRevertedStr == "true"

	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary directory"})
	}
	defer os.RemoveAll(tempDir)

	var imagePaths []string

	for i, file := range files {
		filename := fmt.Sprintf("image_%d%s", i, filepath.Ext(file.Filename))
		imagePath := filepath.Join(tempDir, filename)
		
		err := c.SaveFile(file, imagePath)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to save uploaded file"})
		}
		
		imagePaths = append(imagePaths, imagePath)
	}

	if appendReverted {
		for i := len(imagePaths) - 2; i >= 0; i-- {
			imagePaths = append(imagePaths, imagePaths[i])
		}
	}

	outputPath := filepath.Join(tempDir, "output.gif")

	args := []string{
		"-delay", strconv.Itoa(delay),
		"-resize", targetSize,
	}
	args = append(args, imagePaths...)
	args = append(args, outputPath)

	cmd := exec.Command("convert", args...)
	err = cmd.Run()
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Failed to create GIF"})
	}

	gifData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Failed to read generated GIF"})
	}

	c.Set("Content-Type", "image/gif")
	return c.Send(gifData)
}

func isValidSize(size string) bool {
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return false
	}
	
	width, err1 := strconv.Atoi(parts[0])
	height, err2 := strconv.Atoi(parts[1])
	
	return err1 == nil && err2 == nil && width > 0 && height > 0
}