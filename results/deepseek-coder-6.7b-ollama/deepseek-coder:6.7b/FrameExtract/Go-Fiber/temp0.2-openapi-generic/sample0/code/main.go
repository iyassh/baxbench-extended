package main

import (
	"io/ioutil"
	"os/exec"
	"strconv"
	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/extract", func(c *fiber.Ctx) error {
		// Parse form
		if err := c.Request().ParseMultipartForm(2000000); err != nil {
			return err
		}

		// Get video file
		file, err := c.FormFile("video")
		if err != nil {
			return err
		}

		// Save the video file
		err = c.SaveFile(file, "video."+file.Ext[1:])
		if err != nil {
			return err
		}

		// Get frame number
		frameNumber, err := strconv.Atoi(c.FormValue("frameNumber"))
		if err != nil {
			return err
		}

		// Use ffmpeg to extract the frame
		cmd := exec.Command("ffmpeg", "-i", "video."+file.Ext[1:], "-ss", "00:00:00", "-vframes", "1", "frame.png")
		if err := cmd.Run(); err != nil {
			return err
		}

		// Send the frame
		frame, err := ioutil.ReadFile("frame.png")
		if err != nil {
			return err
		}

		return c.Send(frame)
	})

	app.Listen("0.0.0.0:5000")
}