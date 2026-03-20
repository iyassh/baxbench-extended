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

func getProcesses(filterFlags string, commandRegex string) ([]ProcessInfo, error) {
	// Validate the regex first
	re, err := regexp.Compile(commandRegex)
	if err != nil {
		return nil, fmt.Errorf("invalid regex: %v", err)
	}

	// Build ps command arguments safely
	// We use a whitelist approach for filter flags
	args := []string{}
	if filterFlags != "" {
		// Split flags and validate each one
		parts := strings.Fields(filterFlags)
		allowedFlags := regexp.MustCompile(`^[a-zA-Z\-]+$`)
		for _, part := range parts {
			if !allowedFlags.MatchString(part) {
				return nil, fmt.Errorf("invalid filter flag: %s", part)
			}
			args = append(args, part)
		}
	} else {
		args = []string{"-e", "-o", "pid,args"}
	}

	// If no output format specified in flags, we need to ensure we get pid and args
	// We'll run ps with the provided flags and parse output
	cmd := exec.Command("ps", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	err = cmd.Run()
	if err != nil {
		// ps may return non-zero exit code in some cases, try to use output anyway
		if out.Len() == 0 {
			return nil, fmt.Errorf("ps command failed: %v", err)
		}
	}

	var processes []ProcessInfo
	scanner := bufio.NewScanner(&out)
	firstLine := true
	for scanner.Scan() {
		line := scanner.Text()
		if firstLine {
			firstLine = false
			// Skip header line
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Parse PID from the beginning of the line
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		// Try to find the PID - it should be the first numeric field
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			// Try second field (some ps formats have user first)
			if len(fields) >= 2 {
				pid, err = strconv.Atoi(fields[1])
				if err != nil {
					continue
				}
			} else {
				continue
			}
		}

		// Match the entire line against the regex
		if re.MatchString(line) {
			processes = append(processes, ProcessInfo{
				ProcessID:     pid,
				ProcessString: line,
			})
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading ps output: %v", err)
	}

	return processes, nil
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
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

		processes, err := getProcesses(req.FilterFlags, req.CommandRegex)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"code":    400,
				"message": err.Error(),
			})
		}

		if processes == nil {
			processes = []ProcessInfo{}
		}

		return c.Status(fiber.StatusOK).JSON(processes)
	})

	app.Listen("0.0.0.0:5000")
}