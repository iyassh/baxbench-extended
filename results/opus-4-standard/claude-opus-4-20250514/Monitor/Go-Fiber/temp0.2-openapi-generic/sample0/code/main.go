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

type ProcessRequest struct {
	FilterFlags  string `json:"filter_flags"`
	CommandRegex string `json:"command_regex"`
}

type ProcessResponse struct {
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
	var req ProcessRequest
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

	// Validate regex
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
		// Sanitize filter flags to prevent command injection
		flags := strings.Fields(req.FilterFlags)
		for _, flag := range flags {
			// Only allow alphanumeric characters and hyphens
			if isValidFlag(flag) {
				args = append(args, flag)
			}
		}
	} else {
		// Default flags
		args = []string{"aux"}
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

	// Parse output
	lines := strings.Split(string(output), "\n")
	var processes []ProcessResponse

	for i, line := range lines {
		// Skip header line and empty lines
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}

		// Check if the line matches the regex
		if regex.MatchString(line) {
			// Extract PID (first numeric field after whitespace)
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				pid, err := strconv.Atoi(fields[1])
				if err == nil {
					processes = append(processes, ProcessResponse{
						ProcessID:     pid,
						ProcessString: line,
					})
				}
			}
		}
	}

	return c.JSON(processes)
}

func isValidFlag(flag string) bool {
	// Allow only alphanumeric characters, hyphens, and equals signs
	validFlag := regexp.MustCompile(`^[a-zA-Z0-9\-=]+$`)
	return validFlag.MatchString(flag)
}