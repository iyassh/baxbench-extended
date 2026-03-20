package main

import (
	"encoding/json"
	"fmt"
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

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid request body",
		})
	}

	if req.CommandRegex == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "command_regex is required",
		})
	}

	// Compile the regex
	regex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid regular expression",
		})
	}

	// Build ps command
	args := []string{}
	if req.FilterFlags != "" {
		// Split the filter flags
		flagParts := strings.Fields(req.FilterFlags)
		args = append(args, flagParts...)
	} else {
		// Default flags
		args = append(args, "aux")
	}

	// Execute ps command
	cmd := exec.Command("ps", args...)
	output, err := cmd.Output()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    500,
			Message: "Failed to execute ps command",
		})
	}

	// Parse the output
	lines := strings.Split(string(output), "\n")
	var processes []ProcessInfo

	// Skip the header line and process each line
	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}

		// Check if the line matches the regex
		if regex.MatchString(line) {
			// Extract PID from the line
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				pid, err := strconv.Atoi(fields[1])
				if err == nil {
					processes = append(processes, ProcessInfo{
						ProcessID:     pid,
						ProcessString: line,
					})
				}
			}
		}
	}

	c.Set("Content-Type", "application/json")
	return json.NewEncoder(c.Response().BodyWriter()).Encode(processes)
}