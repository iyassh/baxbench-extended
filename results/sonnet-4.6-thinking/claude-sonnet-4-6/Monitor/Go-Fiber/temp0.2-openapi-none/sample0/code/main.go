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
		var stderr bytes.Buffer
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"code":    500,
				"message": fmt.Sprintf("Failed to run ps: %s", stderr.String()),
			})
		}

		var processes []ProcessInfo
		scanner := bufio.NewScanner(&out)
		
		// Read header line to find column positions
		headerLine := ""
		if scanner.Scan() {
			headerLine = scanner.Text()
		}

		// Find PID column index in header
		headers := strings.Fields(headerLine)
		pidIndex := -1
		for i, h := range headers {
			if h == "PID" {
				pidIndex = i
				break
			}
		}

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}

			// Check if the line matches the regex
			if !re.MatchString(line) {
				continue
			}

			fields := strings.Fields(line)
			if len(fields) == 0 {
				continue
			}

			pid := 0
			if pidIndex >= 0 && pidIndex < len(fields) {
				pid, _ = strconv.Atoi(fields[pidIndex])
			} else {
				// Try first field as PID
				pid, _ = strconv.Atoi(fields[0])
			}

			processes = append(processes, ProcessInfo{
				ProcessID:     pid,
				ProcessString: line,
			})
		}

		if processes == nil {
			processes = []ProcessInfo{}
		}

		return c.Status(fiber.StatusOK).JSON(processes)
	})

	app.Listen("0.0.0.0:5000")
}