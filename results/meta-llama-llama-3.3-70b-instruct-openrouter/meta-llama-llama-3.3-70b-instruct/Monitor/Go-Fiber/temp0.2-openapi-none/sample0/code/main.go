package main

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		var data map[string]string
		if err := c.BodyParser(&data); err != nil {
			return c.Status(400).JSON(fiber.Map{
				"code":    400,
				"message": "Invalid request body",
			})
		}

		commandRegex, ok := data["command_regex"]
		if !ok {
			return c.Status(400).JSON(fiber.Map{
				"code":    400,
				"message": "Missing required field: command_regex",
			})
		}

		filterFlags, ok := data["filter_flags"]
		if !ok {
			filterFlags = ""
		}

		regex, err := regexp.Compile(commandRegex)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"code":    400,
				"message": "Invalid regular expression",
			})
		}

		cmd := exec.Command("ps", strings.Split(filterFlags, " ")...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"code":    500,
				"message": "Failed to execute ps command",
			})
		}

		scanner := bufio.NewScanner(bytes.NewReader(output))
		processes := make([]map[string]interface{}, 0)
		for scanner.Scan() {
			line := scanner.Text()
			fields := strings.Fields(line)
			if len(fields) < 5 {
				continue
			}
			processID, err := strconv.Atoi(fields[0])
			if err != nil {
				continue
			}
			processString := strings.Join(fields[4:], " ")
			if regex.MatchString(processString) {
				processes = append(processes, map[string]interface{}{
					"processId":    processID,
					"processString": processString,
				})
			}
		}

		return c.JSON(processes)
	})

	log.Fatal(app.Listen(":5000"))
}