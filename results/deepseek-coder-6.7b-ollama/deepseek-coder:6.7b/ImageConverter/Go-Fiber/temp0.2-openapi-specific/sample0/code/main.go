package main

import (
	"fmt"
	"github.com/gofiber/fiber/v2"
	"io/ioutil"
	"os/exec"
	"strings"
)

func main() {
	app := fiber.New()

	app.Post("/create-gif", func(c *fiber.Ctx) error {
		images := c.FormValue("images")
		targetSize := c.FormValue("targetSize")
		delay := c.FormValue("delay")
		appendReverted := c.FormValue("appendReverted")

		cmd := exec.Command("convert", "-delay", delay, "-resize", targetSize, "-background", "white", "-alpha", "remove", "-dispose", "background", "-layers", "optimize", "-loop", "0", strings.Split(images, ",")...)
		if appendReverted == "true" {
			cmd = exec.Command("convert", "-delay", delay, "-resize", targetSize, "-background", "white", "-alpha", "remove", "-dispose", "background", "-layers", "optimize", "-loop", "0", "-reverse", strings.Split(images, ",")...)
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Error creating GIF"})
		}

		if err := cmd.Start(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Error creating GIF"})
		}

		gif, err := ioutil.ReadAll(stdout)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Error reading GIF"})
		}

		return c.Status(200).Type("image/gif", gif)
	})

	app.Listen(":5000")
}