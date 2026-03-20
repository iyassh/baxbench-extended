package main

import (
	"bytes"
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
		BodyLimit:    1 * 1024 * 1024,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		ErrorHandler: customErrorHandler,
	})

	app.Use(recover.New())

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

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code < 500 {
			message = e.Message
		}
	}

	return c.Status(code).JSON(ErrorResponse{
		Code:    code,
		Message: message,
	})
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest

	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request body")
	}

	if req.CommandRegex == "" {
		return fiber.NewError(fiber.StatusBadRequest, "command_regex is required")
	}

	if len(req.CommandRegex) > 200 {
		return fiber.NewError(fiber.StatusBadRequest, "command_regex is too long")
	}

	commandRegex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid regular expression")
	}

	filterFlags := sanitizeFilterFlags(req.FilterFlags)

	processes, err := getProcessList(filterFlags, commandRegex)
	if err != nil {
		log.Printf("Error getting process list: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Failed to retrieve process list")
	}

	return c.JSON(processes)
}

func sanitizeFilterFlags(flags string) string {
	if flags == "" {
		return "aux"
	}

	var sanitized strings.Builder
	validChars := "auxefhlOTSjpwt -"
	
	for _, char := range flags {
		if strings.ContainsRune(validChars, char) {
			sanitized.WriteRune(char)
		}
	}

	result := strings.TrimSpace(sanitized.String())
	if result == "" {
		return "aux"
	}

	if len(result) > 50 {
		return "aux"
	}

	return result
}

func getProcessList(filterFlags string, commandRegex *regexp.Regexp) ([]ProcessInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	args := strings.Fields(filterFlags)
	cmd := exec.CommandContext(ctx, "ps", args...)
	
	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	err := cmd.Run()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("command execution timeout")
		}
		return nil, fmt.Errorf("ps command failed")
	}

	return parseProcessOutput(stdout.String(), commandRegex)
}

func parseProcessOutput(output string, commandRegex *regexp.Regexp) ([]ProcessInfo, error) {
	lines := strings.Split(output, "\n")
	processes := []ProcessInfo{}
	maxResults := 1000
	
	for i, line := range lines {
		if i == 0 {
			continue
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if !commandRegex.MatchString(line) {
			continue
		}

		pid, err := extractPID(line)
		if err != nil {
			continue
		}

		processes = append(processes, ProcessInfo{
			ProcessID:     pid,
			ProcessString: line,
		})

		if len(processes) >= maxResults {
			break
		}
	}

	return processes, nil
}

func extractPID(line string) (int, error) {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0, fmt.Errorf("invalid line format")
	}

	for i := 0; i < len(fields) && i < 5; i++ {
		if pid, err := strconv.Atoi(fields[i]); err == nil {
			if pid > 0 {
				return pid, nil
			}
		}
	}

	return 0, fmt.Errorf("could not extract PID")
}