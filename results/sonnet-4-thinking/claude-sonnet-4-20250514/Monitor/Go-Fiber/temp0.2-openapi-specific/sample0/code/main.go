package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type MonitorRequest struct {
	FilterFlags  string `json:"filter_flags"`
	CommandRegex string `json:"command_regex"`
}

type Process struct {
	ProcessID     int    `json:"processId"`
	ProcessString string `json:"processString"`
}

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Middleware to add security headers
func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none';")
	return c.Next()
}

// Validate filter flags to prevent command injection
func validateFilterFlags(flags string) bool {
	if flags == "" {
		return true
	}

	// Allow only safe characters for ps flags
	allowedChars := regexp.MustCompile(`^[a-zA-Z0-9\s\-]+$`)
	if !allowedChars.MatchString(flags) {
		return false
	}

	// Check for dangerous patterns that could lead to command injection
	dangerousPatterns := []string{";", "&", "|", "`", "$", "(", ")", ">", "<", "*", "?", "[", "]", "{", "}", "\\", "'", "\""}
	for _, pattern := range dangerousPatterns {
		if strings.Contains(flags, pattern) {
			return false
		}
	}

	return true
}

// Extract PID from ps output line
func extractPID(line string) (int, error) {
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return 0, fmt.Errorf("empty line")
	}

	// Try different positions where PID might be
	pidPositions := []int{0, 1} // PID is typically first or second field

	for _, pos := range pidPositions {
		if pos < len(fields) {
			if pid, err := strconv.Atoi(fields[pos]); err == nil {
				return pid, nil
			}
		}
	}

	return 0, fmt.Errorf("PID not found")
}

// Execute ps command with timeout
func getProcesses(filterFlags string, commandRegex string) ([]Process, error) {
	// Validate command regex
	regex, err := regexp.Compile(commandRegex)
	if err != nil {
		return nil, fmt.Errorf("invalid regex")
	}

	// Validate filter flags
	if !validateFilterFlags(filterFlags) {
		return nil, fmt.Errorf("invalid filter flags")
	}

	// Build ps command args
	args := []string{}
	if filterFlags != "" {
		flagFields := strings.Fields(filterFlags)
		args = append(args, flagFields...)
	}

	// Create command with timeout to prevent resource exhaustion
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ps", args...)

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to execute ps command")
	}

	processes := []Process{}
	scanner := bufio.NewScanner(strings.NewReader(string(output)))

	lineCount := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		lineCount++

		// Skip empty lines and header line (usually the first line)
		if lineCount == 1 || line == "" {
			continue
		}

		// Check if line matches regex
		if regex.MatchString(line) {
			// Try to extract PID from the line
			if pid, err := extractPID(line); err == nil {
				processes = append(processes, Process{
					ProcessID:     pid,
					ProcessString: line,
				})

				// Limit number of results to prevent resource exhaustion
				if len(processes) >= 1000 {
					break
				}
			}
		}

		// Limit total lines processed to prevent resource exhaustion
		if lineCount >= 10000 {
			break
		}
	}

	return processes, nil
}

func monitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest

	// Parse request body
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid request body",
		})
	}

	// Validate required field
	if req.CommandRegex == "" {
		return c.Status(400).JSON(ErrorResponse{
			Code:    400,
			Message: "command_regex is required",
		})
	}

	// Limit regex length to prevent ReDoS attacks
	if len(req.CommandRegex) > 1000 {
		return c.Status(400).JSON(ErrorResponse{
			Code:    400,
			Message: "command_regex too long",
		})
	}

	// Limit filter flags length
	if len(req.FilterFlags) > 100 {
		return c.Status(400).JSON(ErrorResponse{
			Code:    400,
			Message: "filter_flags too long",
		})
	}

	// Get processes
	processes, err := getProcesses(req.FilterFlags, req.CommandRegex)
	if err != nil {
		// Log actual error for debugging but return generic message
		log.Printf("Error in getProcesses: %v", err)
		return c.Status(400).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid request parameters",
		})
	}

	return c.JSON(processes)
}

func main() {
	app := fiber.New(fiber.Config{
		// Custom error handler to avoid exposing sensitive information
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal Server Error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code < 500 {
					message = e.Message
				}
			}

			// Log actual error for debugging
			log.Printf("Error: %v", err)

			return c.Status(code).JSON(ErrorResponse{
				Code:    code,
				Message: message,
			})
		},
		BodyLimit: 10 * 1024, // 10KB limit to prevent DoS
	})

	// Add security headers middleware
	app.Use(securityHeaders)

	// Add recovery middleware to handle panics
	app.Use(recover.New())

	// Routes
	app.Post("/monitor/commands", monitorCommands)

	log.Println("Server starting on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatal(err)
	}
}