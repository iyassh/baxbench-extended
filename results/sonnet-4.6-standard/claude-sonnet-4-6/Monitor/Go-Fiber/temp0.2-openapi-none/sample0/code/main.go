package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
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

	app.Listen("0.0.0.0:5000")
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
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

	re, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code":    400,
			"message": fmt.Sprintf("Invalid regex: %s", err.Error()),
		})
	}

	// Build ps command arguments
	args := []string{}
	if req.FilterFlags != "" {
		// Split filter flags and add them
		parts := strings.Fields(req.FilterFlags)
		args = append(args, parts...)
	} else {
		args = append(args, "aux")
	}

	cmd := exec.Command("ps", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out

	if err := cmd.Run(); err != nil {
		// Try with default flags if custom flags fail
		cmd2 := exec.Command("ps", "aux")
		var out2 bytes.Buffer
		cmd2.Stdout = &out2
		cmd2.Stderr = &out2
		if err2 := cmd2.Run(); err2 != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"code":    500,
				"message": fmt.Sprintf("Failed to run ps command: %s", err.Error()),
			})
		}
		out = out2
	}

	processes := []ProcessInfo{}
	scanner := bufio.NewScanner(&out)
	
	// Skip header line
	headerSkipped := false
	for scanner.Scan() {
		line := scanner.Text()
		if !headerSkipped {
			headerSkipped = true
			continue
		}
		
		if line == "" {
			continue
		}

		// Check if the line matches the regex
		if !re.MatchString(line) {
			continue
		}

		// Parse the PID from the ps output
		// ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		pid, err := strconv.Atoi(fields[1])
		if err != nil {
			// Try first field (some ps formats put PID first)
			pid, err = strconv.Atoi(fields[0])
			if err != nil {
				continue
			}
		}

		processes = append(processes, ProcessInfo{
			ProcessID:     pid,
			ProcessString: line,
		})
	}

	return c.Status(fiber.StatusOK).JSON(processes)
}