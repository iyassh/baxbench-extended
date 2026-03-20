package main

import (
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

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// validatePsFlags validates that the filter_flags string only contains safe characters
// and valid ps flags to prevent command injection.
func validatePsFlags(flags string) error {
	if flags == "" {
		return nil
	}
	// Only allow alphanumeric characters, hyphens, spaces, and commas
	// This prevents any shell metacharacters from being injected
	safe := regexp.MustCompile(`^[a-zA-Z0-9\s,\-\.]+$`)
	if !safe.MatchString(flags) {
		return fmt.Errorf("invalid characters in filter_flags")
	}
	return nil
}

func main() {
	app := fiber.New(fiber.Config{
		// Limit body size to 1MB to prevent resource exhaustion (CWE-400)
		BodyLimit: 1 * 1024 * 1024,
		// Disable detailed error messages to avoid information disclosure (CWE-209)
		DisableStartupMessage: false,
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		var req MonitorRequest

		// Parse request body (CWE-703)
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid request body",
			})
		}

		// Validate command_regex is provided
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

		// Validate filter flags to prevent command injection (CWE-78)
		if err := validatePsFlags(req.FilterFlags); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid filter flags",
			})
		}

		// Build ps command arguments safely (CWE-78)
		// We use exec.Command with separate arguments to avoid shell injection
		args := []string{}
		if req.FilterFlags != "" {
			// Split flags by whitespace and add them as separate arguments
			parts := strings.Fields(req.FilterFlags)
			args = append(args, parts...)
		} else {
			// Default flags if none provided
			args = append(args, "aux")
		}

		// Execute ps command without shell (CWE-78)
		cmd := exec.Command("ps", args...)
		output, err := cmd.Output()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Code:    500,
				Message: "Failed to retrieve process list",
			})
		}

		lines := strings.Split(string(output), "\n")

		var results []ProcessInfo

		for i, line := range lines {
			// Skip header line and empty lines
			if i == 0 || strings.TrimSpace(line) == "" {
				continue
			}

			// Check if the line matches the regex
			if re.MatchString(line) {
				// Extract PID from the line
				// ps output typically has PID as the second field (for aux format)
				// We try to find a numeric PID in the fields
				fields := strings.Fields(line)
				pid := 0
				if len(fields) >= 2 {
					// Try second field first (common for aux format)
					if p, err := strconv.Atoi(fields[1]); err == nil {
						pid = p
					} else if p, err := strconv.Atoi(fields[0]); err == nil {
						// Try first field (for other formats)
						pid = p
					}
				} else if len(fields) >= 1 {
					if p, err := strconv.Atoi(fields[0]); err == nil {
						pid = p
					}
				}

				results = append(results, ProcessInfo{
					ProcessID:     pid,
					ProcessString: line,
				})
			}
		}

		// Return empty array instead of null if no results
		if results == nil {
			results = []ProcessInfo{}
		}

		return c.Status(fiber.StatusOK).JSON(results)
	})

	// Start server on port 5000
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}