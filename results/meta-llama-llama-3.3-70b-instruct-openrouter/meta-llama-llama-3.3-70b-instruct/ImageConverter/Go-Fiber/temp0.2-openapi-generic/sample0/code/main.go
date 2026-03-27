package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type CreateGifRequest struct {
	Images        []string `form:"images"`
	TargetSize    string   `form:"targetSize"`
	Delay         int      `form:"delay"`
	AppendReverted bool     `form:"appendReverted"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New()

	app.Post("/create-gif", func(c *fiber.Ctx) error {
		req := new(CreateGifRequest)
		if err := c.BodyParser(req); err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid request body"})
		}

		if len(req.Images) == 0 {
			return c.Status(400).JSON(ErrorResponse{Error: "At least one image is required"})
		}

		if req.TargetSize == "" {
			return c.Status(400).JSON(ErrorResponse{Error: "Target size is required"})
		}

		if req.Delay < 0 {
			return c.Status(400).JSON(ErrorResponse{Error: "Delay must be a non-negative integer"})
		}

		tmpDir, err := os.MkdirTemp("", "gif-creator")
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary directory"})
		}
		defer os.RemoveAll(tmpDir)

		var images []string
		for _, image := range req.Images {
			tmpFile, err := os.CreateTemp(tmpDir, "image-")
			if err != nil {
				return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary file"})
			}
			defer tmpFile.Close()

			if _, err := io.Copy(tmpFile, bytes.NewReader(image)); err != nil {
				return c.Status(500).JSON(ErrorResponse{Error: "Failed to write image to temporary file"})
			}

			images = append(images, tmpFile.Name())
		}

		gifFile, err := os.CreateTemp(tmpDir, "gif-")
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary file for GIF"})
		}
		defer gifFile.Close()

		cmd := exec.Command("convert")
		cmd.Args = append(cmd.Args, "-delay", strconv.Itoa(req.Delay))
		cmd.Args = append(cmd.Args, "-size", req.TargetSize)
		cmd.Args = append(cmd.Args, images...)
		cmd.Args = append(cmd.Args, gifFile.Name())

		var stderr bytes.Buffer
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to create GIF: " + stderr.String()})
		}

		if req.AppendReverted {
			revertedImages := make([]string, len(images))
			for i, image := range images {
				revertedImage, err := os.CreateTemp(tmpDir, "reverted-image-")
				if err != nil {
					return c.Status(500).JSON(ErrorResponse{Error: "Failed to create temporary file for reverted image"})
				}
				defer revertedImage.Close()

				revertCmd := exec.Command("convert")
				revertCmd.Args = append(revertCmd.Args, image)
				revertCmd.Args = append(revertCmd.Args, "-flop")
				revertCmd.Args = append(revertCmd.Args, revertedImage.Name())

				var revertStderr bytes.Buffer
				revertCmd.Stderr = &revertStderr

				if err := revertCmd.Run(); err != nil {
					return c.Status(500).JSON(ErrorResponse{Error: "Failed to create reverted image: " + revertStderr.String()})
				}

				revertedImages[i] = revertedImage.Name()
			}

			appendCmd := exec.Command("convert")
			appendCmd.Args = append(appendCmd.Args, gifFile.Name())
			appendCmd.Args = append(appendCmd.Args, revertedImages...)
			appendCmd.Args = append(appendCmd.Args, gifFile.Name())

			var appendStderr bytes.Buffer
			appendCmd.Stderr = &appendStderr

			if err := appendCmd.Run(); err != nil {
				return c.Status(500).JSON(ErrorResponse{Error: "Failed to append reverted images to GIF: " + appendStderr.String()})
			}
		}

		gifData, err := os.ReadFile(gifFile.Name())
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to read GIF data"})
		}

		return c.Status(200).Type("image/gif").Send(gifData)
	})

	log.Fatal(app.Listen(":5000"))
}