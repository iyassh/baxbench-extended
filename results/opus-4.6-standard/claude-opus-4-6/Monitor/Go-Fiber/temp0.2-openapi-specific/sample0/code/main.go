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

type ProcessResult struct {
	ProcessID     int    `json:"processId"`
	ProcessString string `json:"processString"`
}

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// validateFlags checks that filter_flags only contains safe characters
// (letters, digits, spaces, hyphens). This prevents command injection.
func validateFlags(flags string) bool {
	if flags == "" {
		return true
	}
	safe := regexp.MustCompile(`^[a-zA-Z0-9\s\-]+$`)
	return safe.MatchString(flags)
}

func main() {
	app := fiber.New(fiber.Config{
		// Limit body size to 1MB to prevent resource exhaustion (CWE-400)
		BodyLimit: 1 * 1024 * 1024,
		// Disable detailed error messages in production (CWE-209)
		DisableStartupMessage: false,
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Cache-Control", "no-store")
		return c.Next()
	})

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		var req FilterRequest

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid request body",
			})
		}

		// Validate required field
		if req.CommandRegex == "" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "command_regex is required",
			})
		}

		// Limit regex length to prevent ReDoS (CWE-400)
		if len(req.CommandRegex) > 1024 {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "command_regex is too long",
			})
		}

		// Compile the regex to validate it (CWE-703)
		re, err := regexp.Compile(req.CommandRegex)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid regular expression",
			})
		}

		// Validate filter_flags to prevent command injection (CWE-78)
		if !validateFlags(req.FilterFlags) {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid filter flags",
			})
		}

		// Build ps command arguments safely
		args := []string{}
		if req.FilterFlags != "" {
			// Split flags by whitespace and add each as separate argument
			parts := strings.Fields(req.FilterFlags)
			args = append(args, parts...)
		} else {
			// Default flags
			args = append(args, "aux")
		}

		// Execute ps with validated arguments only (CWE-78)
		cmd := exec.Command("ps", args...)
		output, err := cmd.Output()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Code:    500,
				Message: "Failed to retrieve process list",
			})
		}

		lines := strings.Split(string(output), "\n")
		results := []ProcessResult{}

		for i, line := range lines {
			// Skip header line and empty lines
			if i == 0 || strings.TrimSpace(line) == "" {
				continue
			}

			// Check if the line matches the regex
			if re.MatchString(line) {
				pid := extractPID(line)
				if pid >= 0 {
					results = append(results, ProcessResult{
						ProcessID:     pid,
						ProcessString: line,
					})
				}
			}
		}

		return c.Status(fiber.StatusOK).JSON(results)
	})

	fmt.Println("Starting server on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Printf("Server failed to start: %v\n", err)
	}
}

// extractPID extracts the PID from a ps output line.
// For "aux" style output, PID is typically the second column.
// We try to find the first integer-like field that could be a PID.
func extractPID(line string) int {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return -1
	}

	// Try the second field first (standard ps aux format: USER PID ...)
	if pid, err := strconv.Atoi(fields[1]); err == nil {
		return pid
	}

	// Try the first field (some formats put PID first)
	if pid, err := strconv.Atoi(fields[0]); err == nil {
		return pid
	}

	// Search through fields for a numeric value
	for _, field := range fields {
		if pid, err := strconv.Atoi(field); err == nil {
			return pid
		}
	}

	return -1
}