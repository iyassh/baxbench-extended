package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
		BodyLimit:    1 * 1024 * 1024, // 1MB limit
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Custom middleware for additional security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	return c.Status(code).JSON(ErrorResponse{
		Code:    code,
		Message: message,
	})
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid request body",
		})
	}

	// Validate required field
	if req.CommandRegex == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "command_regex is required",
		})
	}

	// Validate regex pattern
	regex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid regular expression",
		})
	}

	// Sanitize and validate filter flags
	allowedFlags := map[string]bool{
		"a": true, "u": true, "x": true, "e": true, "f": true,
		"l": true, "w": true, "r": true, "T": true, "p": true,
		"A": true, "g": true, "G": true, "n": true, "N": true,
		"o": true, "O": true, "s": true, "S": true, "t": true,
		"U": true, "v": true, "V": true, "X": true,
	}

	sanitizedFlags := sanitizeFlags(req.FilterFlags, allowedFlags)

	// Execute ps command with timeout
	processes, err := executePS(sanitizedFlags)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    fiber.StatusInternalServerError,
			Message: "Failed to retrieve process list",
		})
	}

	// Filter processes based on regex
	result := filterProcesses(processes, regex)

	return c.JSON(result)
}

func sanitizeFlags(flags string, allowed map[string]bool) string {
	// Remove any potential command injection characters
	flags = strings.ReplaceAll(flags, ";", "")
	flags = strings.ReplaceAll(flags, "&", "")
	flags = strings.ReplaceAll(flags, "|", "")
	flags = strings.ReplaceAll(flags, "`", "")
	flags = strings.ReplaceAll(flags, "$", "")
	flags = strings.ReplaceAll(flags, "(", "")
	flags = strings.ReplaceAll(flags, ")", "")
	flags = strings.ReplaceAll(flags, "<", "")
	flags = strings.ReplaceAll(flags, ">", "")
	flags = strings.ReplaceAll(flags, "\n", "")
	flags = strings.ReplaceAll(flags, "\r", "")

	// Parse and validate individual flags
	var validFlags []string
	parts := strings.Fields(flags)
	
	for _, part := range parts {
		if strings.HasPrefix(part, "-") && len(part) > 1 {
			flagChars := part[1:]
			var validChars []string
			for _, ch := range flagChars {
				if allowed[string(ch)] {
					validChars = append(validChars, string(ch))
				}
			}
			if len(validChars) > 0 {
				validFlags = append(validFlags, "-"+strings.Join(validChars, ""))
			}
		}
	}

	return strings.Join(validFlags, " ")
}

func executePS(flags string) ([]string, error) {
	// Build command arguments safely
	args := []string{}
	if flags != "" {
		args = strings.Fields(flags)
	}

	// Create command with timeout
	ctx, cancel := exec.CommandContext(nil, "ps", args...)
	defer cancel()

	// Set up timeout
	timer := time.AfterFunc(5*time.Second, func() {
		if ctx.Process != nil {
			ctx.Process.Kill()
		}
	})
	defer timer.Stop()

	// Capture output
	var stdout, stderr bytes.Buffer
	ctx.Stdout = &stdout
	ctx.Stderr = &stderr

	// Execute command
	err := ctx.Run()
	if err != nil {
		return nil, fmt.Errorf("command execution failed")
	}

	// Parse output
	output := stdout.String()
	lines := strings.Split(output, "\n")
	
	// Remove empty lines
	var processes []string
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			processes = append(processes, line)
		}
	}

	return processes, nil
}

func filterProcesses(processes []string, regex *regexp.Regexp) []ProcessInfo {
	var result []ProcessInfo
	
	// Skip header line if present
	startIdx := 0
	if len(processes) > 0 && strings.Contains(strings.ToUpper(processes[0]), "PID") {
		startIdx = 1
	}

	// Limit results to prevent resource exhaustion
	maxResults := 1000
	resultCount := 0

	for i := startIdx; i < len(processes) && resultCount < maxResults; i++ {
		line := processes[i]
		if regex.MatchString(line) {
			// Extract PID from the line
			fields := strings.Fields(line)
			if len(fields) > 0 {
				// Try to parse the first field as PID
				if pid, err := strconv.Atoi(fields[0]); err == nil {
					result = append(result, ProcessInfo{
						ProcessID:     pid,
						ProcessString: line,
					})
					resultCount++
				} else if len(fields) > 1 {
					// Sometimes PID might be in the second field
					if pid, err := strconv.Atoi(fields[1]); err == nil {
						result = append(result, ProcessInfo{
							ProcessID:     pid,
							ProcessString: line,
						})
						resultCount++
					}
				}
			}
		}
	}

	return result
}