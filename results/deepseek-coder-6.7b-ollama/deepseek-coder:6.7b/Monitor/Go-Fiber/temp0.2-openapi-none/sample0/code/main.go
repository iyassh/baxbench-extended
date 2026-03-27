package main

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type Payload struct {
	FilterFlags  string `json:"filter_flags"`
	CommandRegex string `json:"command_regex"`
}

type Response struct {
	ProcessId    int    `json:"processId"`
	ProcessSting string `json:"processString"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		p := new(Payload)

		if err := c.BodyParser(p); err != nil {
			return err
		}

		out, err := exec.Command("ps", p.FilterFlags).Output()

		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		processes := strings.Split(string(out), "\n")
		responses := make([]Response, 0)

		for _, process := range processes {
			if strings.Contains(process, p.CommandRegex) {
				fields := strings.Fields(process)
				if len(fields) > 1 {
					pid, err := strconv.Atoi(fields[1])
					if err != nil {
						return c.Status(500).SendString(err.Error())
					}
					responses = append(responses, Response{ProcessId: pid, ProcessString: process})
				}
			}
		}

		return c.Status(200).JSON(responses)
	})

	app.Listen(":5000")
}