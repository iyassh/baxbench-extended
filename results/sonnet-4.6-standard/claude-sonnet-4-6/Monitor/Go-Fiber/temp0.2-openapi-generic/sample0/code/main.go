package main

import (
	"bufio"
	"bytes"
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

	// Validate the regex
	compiledRegex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code":    400,
			"message": fmt.Sprintf("Invalid regex: %s", err.Error()),
		})
	}

	// Build ps command arguments safely
	// Default flags if none provided
	flags := req.FilterFlags
	if flags == "" {
		flags = "aux"
	}

	// Split flags into individual arguments to avoid shell injection
	flagArgs := strings.Fields(flags)

	// Validate flags - only allow alphanumeric characters, hyphens, and spaces
	for _, flag := range flagArgs {
		for _, ch := range flag {
			if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-') {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"code":    400,
					"message": "Invalid filter_flags: only alphanumeric characters and hyphens are allowed",
				})
			}
		}
	}

	// Execute ps command with the provided flags
	cmd := exec.Command("ps", flagArgs...)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"code":    500,
			"message": fmt.Sprintf("Failed to execute ps command: %s", err.Error()),
		})
	}

	// Parse the output
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

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Check if the line matches the regex
		if !compiledRegex.MatchString(line) {
			continue
		}

		// Extract PID - it's typically the first or second field depending on ps flags
		// For "aux" format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
		// For other formats it may differ
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		// Try to find PID - attempt first field, then second field
		pid := -1
		for i := 0; i < len(fields) && i < 3; i++ {
			if p, err := strconv.Atoi(fields[i]); err == nil {
				pid = p
				break
			}
		}

		if pid == -1 {
			continue
		}

		processes = append(processes, ProcessInfo{
			ProcessID:     pid,
			ProcessString: line,
		})
	}

	if err := scanner.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"code":    500,
			"message": fmt.Sprintf("Error reading ps output: %s", err.Error()),
		})
	}

	return c.Status(fiber.StatusOK).JSON(processes)
}