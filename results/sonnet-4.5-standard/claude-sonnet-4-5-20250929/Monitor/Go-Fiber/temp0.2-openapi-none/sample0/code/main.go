<CODE>
package main

import (
	"encoding/json"
	"log"
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

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"code":    400,
			"message": "Invalid request body",
		})
	}

	if req.CommandRegex == "" {
		return c.Status(400).JSON(fiber.Map{
			"code":    400,
			"message": "command_regex is required",
		})
	}

	cmdRegex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"code":    400,
			"message": "Invalid regular expression",
		})
	}

	processes, err := getProcesses(req.FilterFlags, cmdRegex)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"code":    500,
			"message": "Failed to retrieve processes: " + err.Error(),
		})
	}

	return c.JSON(processes)
}

func getProcesses(filterFlags string, cmdRegex *regexp.Regexp) ([]ProcessInfo, error) {
	var args []string
	if filterFlags != "" {
		args = strings.Fields(filterFlags)
	} else {
		args = []string{"aux"}
	}

	cmd := exec.Command("ps", args...)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	lines := strings.Split(string(output), "\n")
	var processes []ProcessInfo

	for i, line := range lines {
		if i == 0 || line == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		pidStr := fields[1]
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}

		if cmdRegex.MatchString(line) {
			processes = append(processes, ProcessInfo{
				ProcessID:     pid,
				ProcessString: line,
			})
		}
	}

	return processes, nil
}
</CODE>