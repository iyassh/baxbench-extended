package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/create-gif", func(c *fiber.Ctx) error {
		// Multipart form parsing
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid form data"})
		}

		// Form data
		images := form.File["images"]
		targetSize := form.Get("targetSize")
		delay := form.Get("delay")
		appendReverted := form.Get("appendReverted")

		// Validations
		if len(images) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Images are required"})
		}

		if targetSize == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Target size is required"})
		}

		if _, err := strconv.Atoi(delay); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid delay"})
		}

		if appendReverted != "true" && appendReverted != "false" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid appendReverted value"})
		}

		// Temporary directory
		tempDir, err := ioutil.TempDir("", "images")
		if err != nil {
			log.Fatal(err)
		}
		defer os.RemoveAll(tempDir)

		// Save images
		for _, image := range images {
			err := c.SaveFile(image, fmt.Sprintf("%s/%s", tempDir, image.Filename))
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save images"})
			}
		}

		// Convert images to GIF
		cmd := exec.Command("convert", "-delay", delay, "-resize", targetSize, fmt.Sprintf("%s/*", tempDir), "-loop", "0", "-layers", "optimize", "output.gif")
		err = cmd.Run()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create GIF"})
		}

		// Append reverted images
		if appendReverted == "true" {
			cmd = exec.Command("convert", "output.gif", "-coalesce", "null:", "-layers", "optimize", "output.gif")
			err = cmd.Run()
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to append reverted images"})
			}
		}

		// Send GIF
		return c.SendFile("output.gif", true)
	})

	app.Listen(":5000")
}