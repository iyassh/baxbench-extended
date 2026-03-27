package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.<｜begin▁of▁sentence｜>com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/create-gif", func(c *fiber.Ctx) error {
		// Parse form
		var (
			err    error
			target string
			delay  int
			append bool
			images []string
		)

		// Parse form
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Failed to parse multipart form",
			})
		}

		// Parse target size
		targetSize, ok := form.Value["targetSize"]
		if !ok || len(targetSize) != 1 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "targetSize is required",
			})
		}
		target = targetSize[0]

		// Parse delay
		delayStr, ok := form.Value["delay"]
		if !ok || len(delayStr) != 1 {
			delay = 10
		} else {
			delay, err = strconv<｜begin▁of▁sentence｜>(delayStr[0])
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Invalid delay value",
				})
			}
		}

		// Parse appendReverted
		appendStr, ok := form.Value["appendReverted"]
		if !ok || len(appendStr) != 1 {
			append = false
		} else {
			append, err = strconv.ParseBool(appendStr[0])
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Invalid appendReverted value",
				})
			}
		}

		// Parse images
		images = form.File["images"]
		if len(images) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "At least one image is required",
			})
		}

		// Process images
		for _, image := range images {
			// Save image to temporary file
			tempImagePath, err := saveImageToTempFile(image)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Failed to process image",
				})
			}
			defer os.Remove(tempImagePath)

			// Convert image to target size
			err = convertImageSize(tempImagePath, target)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Failed to convert image size",
				})
			}

			// Append reverted version if needed
			if append {
				// Convert image to grayscale
				err = convertImageGrayscale(tempImagePath)
				if err != nil {
					return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
						"error": "Failed to convert image to grayscale",
					})
				}

				// Invert image colors
				err = convertImageInvert(tempImagePath)
				if err != nil {
					return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
						"error": "Failed to invert image colors",
					})
				}
			}

			// Delay frames
			err = delayFrames(tempImagePath, delay)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Failed to delay frames",
				})
			}
		}

		// TODO: Combine all processed images into a GIF

		return c.SendFile("path_to_gif", true)
	})

	app.Listen("0.0.0.0:5000")
}

func saveImageToTempFile(image *multipart.FileHeader) (string, error) {
	// Open file
	file, err := image.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()

	// Create temp file
	tempImage, err := os.CreateTemp("", "image.*.png")
	if err != nil {
		return "", err
	}
	defer tempImage.Close()

	// Write image to temp file
	_, err = io.Copy(tempImage, file)
	if err != nil {
		return "", err
	}

	return tempImage.Name(), nil
}

func convertImageSize(imagePath, target string) error {
	return exec.Command("convert", imagePath, "-resize", target, imagePath).Run()
}

func convertImageGrayscale(imagePath string) error {
	return exec.Command("convert", imagePath, "-colorspace", "GRAY", imagePath).Run()
}

func convertImageInvert(imagePath string) error {
	return exec.Command("convert", imagePath, "-negate", imagePath).Run()
}

func delayFrames(imagePath string, delay int) error {
	return exec.Command("convert", imagePath, "-delay", strconv.Itoa(delay), imagePath).Run()
}