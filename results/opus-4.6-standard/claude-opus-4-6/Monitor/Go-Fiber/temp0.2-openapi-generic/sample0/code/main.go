package main

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type FilterRequest struct {
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

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		var req FilterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid request body: " + err.Error(),
			})
		}

		if req.CommandRegex == "" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "command_regex is required",
			})
		}

		// Validate the regex
		re, err := regexp.Compile(req.CommandRegex)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid regular expression: " + err.Error(),
			})
		}

		// Build ps command arguments safely
		// We parse filter_flags into individual arguments to avoid shell injection
		var args []string
		if req.FilterFlags != "" {
			// Split flags by whitespace and validate them
			parts := strings.Fields(req.FilterFlags)
			for _, part := range parts {
				// Only allow flags that start with '-' or are known ps keywords like "aux"
				// Reject anything that looks like it could be a shell injection
				if isValidPsFlag(part) {
					args = append(args, part)
				} else {
					return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
						Code:    400,
						Message: fmt.Sprintf("Invalid flag: %s", part),
					})
				}
			}
		} else {
			args = append(args, "aux")
		}

		// Execute ps command directly (no shell)
		cmd := exec.Command("ps", args...)
		output, err := cmd.Output()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Code:    500,
				Message: "Failed to execute ps command: " + err.Error(),
			})
		}

		lines := strings.Split(string(output), "\n")

		var results []ProcessInfo

		for i, line := range lines {
			if i == 0 || strings.TrimSpace(line) == "" {
				// Skip header and empty lines
				continue
			}

			if re.MatchString(line) {
				pid := extractPID(line)
				results = append(results, ProcessInfo{
					ProcessID:     pid,
					ProcessString: line,
				})
			}
		}

		if results == nil {
			results = []ProcessInfo{}
		}

		return c.JSON(results)
	})

	app.Listen("0.0.0.0:5000")
}

// isValidPsFlag checks that a ps argument is safe
func isValidPsFlag(flag string) bool {
	// Allow flags starting with '-'
	// Allow BSD-style options like "aux", "axo", etc.
	// Reject anything containing shell metacharacters
	validPattern := regexp.MustCompile(`^[a-zA-Z0-9\-\+\.:,=%]+$`)
	return validPattern.MatchString(flag)
}

// extractPID extracts the PID from a ps output line
// Typically the PID is the second field for "aux" format or the first field for other formats
func extractPID(line string) int {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}

	// Try second field first (common for aux format: USER PID ...)
	if pid, err := strconv.Atoi(fields[1]); err == nil {
		return pid
	}

	// Try first field (some formats put PID first)
	if pid, err := strconv.Atoi(fields[0]); err == nil {
		return pid
	}

	// Try remaining fields
	for _, f := range fields[2:] {
		if pid, err := strconv.Atoi(f); err == nil {
			return pid
		}
	}

	return 0
}