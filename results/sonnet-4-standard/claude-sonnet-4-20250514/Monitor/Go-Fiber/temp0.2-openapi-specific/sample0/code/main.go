package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/timeout"
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
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{
				Code:    code,
				Message: "An error occurred",
			})
		},
		BodyLimit: 1024 * 1024, // 1MB limit
	})

	// Security middleware
	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "POST",
		AllowHeaders: "Content-Type",
	}))

	app.Use(recover.New())

	// Rate limiting
	app.Use(limiter.New(limiter.Config{
		Max:        10,
		Expiration: 1 * time.Minute,
	}))

	// Timeout middleware
	app.Use(timeout.New(timeout.Config{
		Timeout: 30 * time.Second,
	}))

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid request format",
		})
	}

	if req.CommandRegex == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "command_regex is required",
		})
	}

	// Validate regex
	regex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid regular expression",
		})
	}

	// Sanitize filter flags
	filterFlags := sanitizeFilterFlags(req.FilterFlags)

	processes, err := getProcesses(filterFlags, regex)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    fiber.StatusInternalServerError,
			Message: "Failed to retrieve processes",
		})
	}

	return c.JSON(processes)
}

func sanitizeFilterFlags(flags string) string {
	if flags == "" {
		return "aux"
	}

	// Only allow safe characters for ps flags
	allowedChars := regexp.MustCompile(`^[auxefwlTSH\s-]*$`)
	if !allowedChars.MatchString(flags) {
		return "aux"
	}

	// Remove any potentially dangerous sequences
	flags = strings.ReplaceAll(flags, ";", "")
	flags = strings.ReplaceAll(flags, "&", "")
	flags = strings.ReplaceAll(flags, "|", "")
	flags = strings.ReplaceAll(flags, "`", "")
	flags = strings.ReplaceAll(flags, "$", "")
	flags = strings.ReplaceAll(flags, "(", "")
	flags = strings.ReplaceAll(flags, ")", "")
	flags = strings.ReplaceAll(flags, "<", "")
	flags = strings.ReplaceAll(flags, ">", "")

	// Limit length
	if len(flags) > 20 {
		return "aux"
	}

	return flags
}

func getProcesses(filterFlags string, commandRegex *regexp.Regexp) ([]ProcessInfo, error) {
	// Build ps command with sanitized flags
	args := []string{}
	if filterFlags != "" {
		flagParts := strings.Fields(filterFlags)
		for _, part := range flagParts {
			if part != "" {
				args = append(args, part)
			}
		}
	} else {
		args = []string{"aux"}
	}

	cmd := exec.Command("ps", args...)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to execute ps command: %w", err)
	}

	var processes []ProcessInfo
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	
	// Skip header line
	if scanner.Scan() {
		// Skip the first line (header)
	}

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// Check if the command matches the regex
		if commandRegex.MatchString(line) {
			pid := extractPID(line)
			if pid > 0 {
				processes = append(processes, ProcessInfo{
					ProcessID:     pid,
					ProcessString: line,
				})
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading ps output: %w", err)
	}

	return processes, nil
}

func extractPID(line string) int {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}

	// PID is typically the second field in ps aux output
	pidStr := fields[1]
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return 0
	}

	return pid
}