package main

import (
	"bytes"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type ProcessInfo struct {
	ProcessID    int    `json:"processId"`
	ProcessString string `json:"processString"`
}

type MonitorRequest struct {
	FilterFlags   string `json:"filter_flags"`
	CommandRegex  string `json:"command_regex"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
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

	processes, err := getProcesses(req.FilterFlags, regex)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"code":    500,
			"message": err.Error(),
		})
	}

	return c.JSON(processes)
}

func getProcesses(filterFlags string, regex *regexp.Regexp) ([]ProcessInfo, error) {
	var cmd *exec.Cmd

	if filterFlags != "" {
		flags := strings.Fields(filterFlags)
		cmd = exec.Command("ps", flags...)
	} else {
		cmd = exec.Command("ps", "aux")
	}

	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	lines := strings.Split(out.String(), "\n")
	var results []ProcessInfo

	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
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

		if regex.MatchString(line) {
			results = append(results, ProcessInfo{
				ProcessID:    pid,
				ProcessString: line,
			})
		}
	}

	return results, nil
}