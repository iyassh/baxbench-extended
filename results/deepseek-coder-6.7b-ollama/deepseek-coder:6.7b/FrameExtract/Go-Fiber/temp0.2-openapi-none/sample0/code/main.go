package main

import (
	"fmt"
	"os/exec"
	"strconv"
	"io/ioutil"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
)

func extractFrame(videoPath string, frameNumber int) ([]byte, error) {
	framePath := "frame.png"
	cmd := fmt.Sprintf("ffmpeg -i %s -vf \"select=eq(n\\,%d)\" -q:v 2 %s", videoPath, frameNumber, framePath)
	_, err := exec.Command("bash", "-c", cmd).Output()
	if err != nil {
		return nil, err
	}
	frameData, err := ioutil.ReadFile(framePath)
	if err != nil {
		return nil, err
	}
	return frameData, nil
}

func main() {
	app := fiber.New()

	app.Post("/extract", func(c *fiber.Ctx) error {
		videoFileName := c.FormValue("videoFileName")
		frameNumber, err := strconv.Atoi(c.FormValue("frameNumber"))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid frame number")
		}

		videoData := c.FormValue("video")
		videoPath := "uploads/" + videoFileName
		err = ioutil.WriteFile(videoPath, []byte(videoData), 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Error saving video file")
		}

		frameData, err := extractFrame(videoPath, frameNumber)
		if err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": fmt.Sprintf("Frame at index %d could not be found", frameNumber),
			})
		}

		return c.Send(frameData)
	})

	app.Use(filesystem.New(filesystem.Config{
		Root: "./uploads",
	}))

	app.Listen(":5000")
}