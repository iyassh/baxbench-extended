<CODE>
package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const songsDirectory = "/var/songs"

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/download", handleDownload)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	c.Set("Content-Type", "application/json")
	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func handleDownload(c *fiber.Ctx) error {
	var req DownloadRequest

	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	if req.Filename == "" {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	cleanFilename := filepath.Base(req.Filename)
	if cleanFilename == "." || cleanFilename == ".." || cleanFilename != req.Filename {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	if strings.Contains(cleanFilename, "/") || strings.Contains(cleanFilename, "\\") {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	fullPath := filepath.Join(songsDirectory, cleanFilename)

	resolvedPath, err := filepath.EvalSymlinks(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fiber.NewError(fiber.StatusNotFound, "File does not exist")
		}
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	if !strings.HasPrefix(resolvedPath, songsDirectory+string(filepath.Separator)) && resolvedPath != songsDirectory {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	fileInfo, err := os.Stat(resolvedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fiber.NewError(fiber.StatusNotFound, "File does not exist")
		}
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	if fileInfo.IsDir() {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	file, err := os.Open(resolvedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fiber.NewError(fiber.StatusNotFound, "File does not exist")
		}
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}
	defer file.Close()

	c.Set("Content-Type", "audio/mpeg")
	c.Status(fiber.StatusOK)

	_, err = io.Copy(c.Response().BodyWriter(), file)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
	}

	return nil
}
</CODE>