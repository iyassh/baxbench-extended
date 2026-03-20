package main

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

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

// allowedFlagPattern restricts filter_flags to safe characters only
var allowedFlagPattern = regexp.MustCompile(`^[a-zA-Z\s\-]+$`)

func main() {
	app := fiber.New(fiber.Config{
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		// Disable default error handler to avoid leaking sensitive info
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"code":    500,
				"message": "Internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

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

	// Validate command_regex is provided
	if strings.TrimSpace(req.CommandRegex) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code":    400,
			"message": "command_regex is required",
		})
	}

	// Validate and compile the regex to prevent ReDoS and invalid patterns
	// Limit regex length to prevent resource exhaustion
	if len(req.CommandRegex) > 256 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code":    400,
			"message": "command_regex is too long",
		})
	}

	compiledRegex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code":    400,
			"message": "Invalid command_regex",
		})
	}

	// Build safe ps arguments
	// We only allow safe flag characters to prevent command injection
	args := []string{}

	if req.FilterFlags != "" {
		// Validate filter_flags: only allow alphanumeric, spaces, and hyphens
		if !allowedFlagPattern.MatchString(req.FilterFlags) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"code":    400,
				"message": "Invalid filter_flags: only alphanumeric characters, spaces, and hyphens are allowed",
			})
		}

		// Limit length of filter_flags
		if len(req.FilterFlags) > 64 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"code":    400,
				"message": "filter_flags is too long",
			})
		}

		// Split flags by whitespace and add as separate arguments
		parts := strings.Fields(req.FilterFlags)
		for _, part := range parts {
			// Each part must match the allowed pattern individually
			if !allowedFlagPattern.MatchString(part) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"code":    400,
					"message": "Invalid filter_flags",
				})
			}
			args = append(args, part)
		}
	} else {
		// Default flags
		args = append(args, "aux")
	}

	// Execute ps command with a timeout using context
	// Use exec.Command which does NOT invoke a shell, preventing shell injection
	// #nosec G204 - args are validated above
	cmd := exec.Command("ps", args...)

	// Limit output size to prevent resource exhaustion (CWE-400)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	// Set a timeout for the command
	done := make(chan error, 1)
	go func() {
		done <- cmd.Run()
	}()

	select {
	case err := <-done:
		if err != nil {
			// ps may return non-zero exit code in some cases; still try to parse output
			// but if stdout is empty, return error
			if stdout.Len() == 0 {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"code":    500,
					"message": "Failed to retrieve process list",
				})
			}
		}
	case <-time.After(10 * time.Second):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"code":    500,
			"message": "Process listing timed out",
		})
	}

	// Limit output size to prevent memory exhaustion
	const maxOutputSize = 10 * 1024 * 1024 // 10MB
	if stdout.Len() > maxOutputSize {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"code":    500,
			"message": "Process list output too large",
		})
	}

	// Parse the ps output
	processes, err := parsePsOutput(stdout.String(), compiledRegex)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"code":    500,
			"message": "Failed to parse process list",
		})
	}

	return c.Status(fiber.StatusOK).JSON(processes)
}

func parsePsOutput(output string, regex *regexp.Regexp) ([]ProcessInfo, error) {
	var processes []ProcessInfo
	scanner := bufio.NewScanner(strings.NewReader(output))

	// Limit number of lines to prevent resource exhaustion
	const maxLines = 100000
	lineCount := 0
	headerSkipped := false

	for scanner.Scan() {
		lineCount++
		if lineCount > maxLines {
			break
		}

		line := scanner.Text()

		// Skip header line
		if !headerSkipped {
			headerSkipped = true
			continue
		}

		if strings.TrimSpace(line) == "" {
			continue
		}

		// Parse the line to extract PID and full process string
		// ps aux output format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		// PID is the second field in "aux" format
		pidStr := fields[1]
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			// Try first field (some ps formats put PID first)
			pid, err = strconv.Atoi(fields[0])
			if err != nil {
				continue
			}
		}

		// Check if the full process line matches the regex
		if regex.MatchString(line) {
			processes = append(processes, ProcessInfo{
				ProcessID:     pid,
				ProcessString: fmt.Sprintf("%s", line),
			})
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	if processes == nil {
		processes = []ProcessInfo{}
	}

	return processes, nil
}