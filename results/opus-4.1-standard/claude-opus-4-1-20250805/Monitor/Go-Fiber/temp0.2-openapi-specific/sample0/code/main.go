package main

import (
	"bytes"
	"context"
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
		BodyLimit:    1 * 1024 * 1024, // 1MB limit
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Add security headers
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
		message = "Request processing error"
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
	if len(req.CommandRegex) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "command_regex too long",
		})
	}

	regexPattern, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid regex pattern",
		})
	}

	// Sanitize and validate filter flags
	allowedFlags := map[string]bool{
		"a": true, "u": true, "x": true, "e": true, "f": true,
		"l": true, "w": true, "T": true, "r": true,
	}

	sanitizedFlags := sanitizeFilterFlags(req.FilterFlags, allowedFlags)

	// Get process list
	processes, err := getProcessList(sanitizedFlags)
	if err != nil {
		log.Printf("Error getting process list: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    fiber.StatusInternalServerError,
			Message: "Failed to retrieve process list",
		})
	}

	// Filter processes by regex
	result := filterProcesses(processes, regexPattern)

	return c.JSON(result)
}

func sanitizeFilterFlags(flags string, allowed map[string]bool) string {
	if flags == "" {
		return "aux"
	}

	// Remove any non-alphanumeric characters except space and hyphen
	cleaned := regexp.MustCompile(`[^a-zA-Z0-9\s\-]`).ReplaceAllString(flags, "")
	
	// Split and validate individual flags
	parts := strings.Fields(cleaned)
	validFlags := []string{}
	
	for _, part := range parts {
		if part == "-T" {
			validFlags = append(validFlags, part)
			continue
		}
		
		// Remove leading dash if present
		flag := strings.TrimPrefix(part, "-")
		
		// Check each character in the flag
		validChars := ""
		for _, ch := range flag {
			if allowed[string(ch)] {
				validChars += string(ch)
			}
		}
		
		if validChars != "" {
			validFlags = append(validFlags, "-"+validChars)
		}
	}
	
	if len(validFlags) == 0 {
		return "aux"
	}
	
	// Limit the number of flags
	if len(validFlags) > 5 {
		validFlags = validFlags[:5]
	}
	
	return strings.Join(validFlags, " ")
}

func getProcessList(flags string) ([]string, error) {
	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Build command arguments safely
	args := []string{}
	if flags != "" {
		for _, flag := range strings.Fields(flags) {
			args = append(args, flag)
		}
	} else {
		args = []string{"aux"}
	}

	cmd := exec.CommandContext(ctx, "ps", args...)
	
	// Limit output size
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("command timeout")
		}
		return nil, fmt.Errorf("command execution failed")
	}

	// Check output size
	output := stdout.String()
	if len(output) > 10*1024*1024 { // 10MB limit
		return nil, fmt.Errorf("output too large")
	}

	lines := strings.Split(output, "\n")
	
	// Limit number of processes
	if len(lines) > 10000 {
		lines = lines[:10000]
	}
	
	return lines, nil
}

func filterProcesses(processes []string, pattern *regexp.Regexp) []ProcessInfo {
	result := []ProcessInfo{}
	
	// Skip header line if present
	startIdx := 0
	if len(processes) > 0 && strings.Contains(processes[0], "PID") {
		startIdx = 1
	}

	// Limit results
	maxResults := 1000
	
	for i := startIdx; i < len(processes) && len(result) < maxResults; i++ {
		line := strings.TrimSpace(processes[i])
		if line == "" {
			continue
		}

		if pattern.MatchString(line) {
			pid := extractPID(line)
			if pid > 0 {
				result = append(result, ProcessInfo{
					ProcessID:     pid,
					ProcessString: sanitizeProcessString(line),
				})
			}
		}
	}

	return result
}

func extractPID(processLine string) int {
	fields := strings.Fields(processLine)
	
	// Try to find PID in common positions
	positions := []int{1, 0} // Usually second field, sometimes first
	
	for _, pos := range positions {
		if pos < len(fields) {
			pid, err := strconv.Atoi(fields[pos])
			if err == nil && pid > 0 {
				return pid
			}
		}
	}
	
	return 0
}

func sanitizeProcessString(line string) string {
	// Remove any control characters
	cleaned := regexp.MustCompile(`[\x00-\x1F\x7F]`).ReplaceAllString(line, " ")
	
	// Limit length
	if len(cleaned) > 500 {
		cleaned = cleaned[:500] + "..."
	}
	
	return cleaned
}