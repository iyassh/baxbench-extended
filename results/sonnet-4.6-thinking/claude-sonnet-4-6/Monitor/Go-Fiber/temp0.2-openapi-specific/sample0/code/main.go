package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
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

// allowedFlagPattern restricts filter_flags to safe characters only
// Allows letters, digits, spaces, and hyphens (typical ps flags)
var allowedFlagPattern = regexp.MustCompile(`^[a-zA-Z0-9\s\-]*$`)

func main() {
	app := fiber.New(fiber.Config{
		// Disable default error handler to avoid leaking sensitive info
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Code:    500,
				Message: "Internal server error",
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

	// Rate limiting to prevent resource exhaustion (CWE-400)
	app.Use(limiter.New(limiter.Config{
		Max:        30,
		Expiration: 60 * time.Second,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(ErrorResponse{
				Code:    429,
				Message: "Too many requests",
			})
		},
	}))

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest

	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid request body",
		})
	}

	// Validate command_regex is present
	if strings.TrimSpace(req.CommandRegex) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "command_regex is required",
		})
	}

	// Limit regex length to prevent ReDoS (CWE-400)
	if len(req.CommandRegex) > 256 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "command_regex is too long",
		})
	}

	// Compile the regex to validate it
	compiledRegex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid command_regex",
		})
	}

	// Build safe ps arguments
	// We only allow safe flag characters to prevent command injection (CWE-78)
	var psArgs []string

	if req.FilterFlags != "" {
		// Validate filter_flags against allowlist pattern
		if !allowedFlagPattern.MatchString(req.FilterFlags) {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid filter_flags: only alphanumeric characters, spaces, and hyphens are allowed",
			})
		}

		// Limit length of filter_flags
		if len(req.FilterFlags) > 64 {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "filter_flags is too long",
			})
		}

		// Split flags by whitespace and add as separate arguments
		parts := strings.Fields(req.FilterFlags)
		psArgs = append(psArgs, parts...)
	} else {
		// Default flags
		psArgs = append(psArgs, "aux")
	}

	// Execute ps with validated arguments (no shell involved - CWE-78 mitigation)
	// Use exec.Command directly (not via shell) to avoid injection
	cmd := exec.Command("ps", psArgs...)

	// Set a timeout via context to prevent resource exhaustion
	// We use a simple approach with a goroutine and timer
	done := make(chan error, 1)
	var output []byte

	go func() {
		var runErr error
		output, runErr = cmd.Output()
		done <- runErr
	}()

	select {
	case err := <-done:
		if err != nil {
			// Don't expose internal error details (CWE-209)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Code:    500,
				Message: "Failed to retrieve process list",
			})
		}
	case <-time.After(10 * time.Second):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    500,
			Message: "Process listing timed out",
		})
	}

	// Parse the output
	processes, err := parseProcessOutput(output, compiledRegex)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    500,
			Message: "Failed to parse process list",
		})
	}

	return c.Status(fiber.StatusOK).JSON(processes)
}

func parseProcessOutput(output []byte, regex *regexp.Regexp) ([]ProcessInfo, error) {
	var processes []ProcessInfo

	scanner := bufio.NewScanner(bytes.NewReader(output))

	// Skip header line
	headerSkipped := false

	for scanner.Scan() {
		line := scanner.Text()

		if !headerSkipped {
			headerSkipped = true
			continue
		}

		if strings.TrimSpace(line) == "" {
			continue
		}

		// Check if the line matches the regex
		if !regex.MatchString(line) {
			continue
		}

		// Parse PID from the line
		// ps output typically has PID as one of the first columns
		// We'll try to extract it
		pid := extractPID(line)

		processes = append(processes, ProcessInfo{
			ProcessID:     pid,
			ProcessString: line,
		})
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	if processes == nil {
		processes = []ProcessInfo{}
	}

	return processes, nil
}

func extractPID(line string) int {
	// ps output fields vary by flags, but PID is typically in the first or second column
	// For "aux" format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
	// For "-e" format: PID TTY TIME CMD
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}

	// Try first field as PID (common for -e, -ef formats)
	if pid, err := strconv.Atoi(fields[0]); err == nil {
		return pid
	}

	// Try second field as PID (common for aux format where first field is USER)
	if pid, err := strconv.Atoi(fields[1]); err == nil {
		return pid
	}

	return 0
}