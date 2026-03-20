package main

import (
	"bytes"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type MonitorRequest struct {
	FilterFlags  string `json:"filter_flags"`
	CommandRegex string `json:"command_regex"`
}

type ProcessInfo struct {
	ProcessID     int    `json:"processId"`
	ProcessString string `json:"processString"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", monitorCommandsHandler)

	app.Listen("0.0.0.0:5000")
}

func monitorCommandsHandler(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code":    400,
			"message": "Invalid request body",
		})
	}

	if req.CommandRegex == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code":    400,
			"message": "command_regex is required",
		})
	}

	regex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code":    400,
			"message": "Invalid regular expression",
		})
	}

	var args []string
	if req.FilterFlags != "" {
		args = strings.Fields(req.FilterFlags)
	} else {
		args = []string{"aux"}
	}

	cmd := exec.Command("ps", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"code":    500,
			"message": "Failed to execute ps command",
		})
	}

	lines := strings.Split(out.String(), "\n")
	var processes []ProcessInfo

	for i := 1; i < len(lines); i++ {
		line := lines[i]
		if strings.TrimSpace(line) == "" {
			continue
		}

		if !regex.MatchString(line) {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		pid, pidErr := strconv.Atoi(fields[1])
		if pidErr != nil {
			pid, pidErr = strconv.Atoi(fields[0])
			if pidErr != nil {
				continue
			}
		}

		processes = append(processes, ProcessInfo{
			ProcessID:     pid,
			ProcessString: line,
		})
	}

	return c.JSON(processes)
}