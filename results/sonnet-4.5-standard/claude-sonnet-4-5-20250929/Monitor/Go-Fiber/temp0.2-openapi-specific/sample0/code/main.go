<CODE>
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
		BodyLimit:    1 * 1024 * 1024,
	})

	app.Use(recover.New())
	app.Use(securityHeaders)

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid request"
		} else if code == fiber.StatusRequestEntityTooLarge {
			message = "Request too large"
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
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid request body",
		})
	}

	if req.CommandRegex == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "command_regex is required",
		})
	}

	if len(req.CommandRegex) > 500 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "command_regex too long",
		})
	}

	if req.FilterFlags != "" && len(req.FilterFlags) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "filter_flags too long",
		})
	}

	commandRegex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid regular expression",
		})
	}

	processes, err := getProcesses(req.FilterFlags, commandRegex)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    fiber.StatusInternalServerError,
			Message: "Failed to retrieve processes",
		})
	}

	return c.JSON(processes)
}

func getProcesses(filterFlags string, commandRegex *regexp.Regexp) ([]ProcessInfo, error) {
	args := buildPsArgs(filterFlags)

	cmd := exec.Command("ps", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	select {
	case <-time.After(5 * time.Second):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return nil, fmt.Errorf("command timeout")
	case err := <-done:
		if err != nil {
			return nil, err
		}
	}

	output := stdout.String()
	lines := strings.Split(output, "\n")

	var processes []ProcessInfo
	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}

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

	return processes, nil
}

func buildPsArgs(filterFlags string) []string {
	if filterFlags == "" {
		return []string{"-e", "-o", "pid,comm,args"}
	}

	safeFlags := sanitizeFlags(filterFlags)
	if safeFlags == "" {
		return []string{"-e", "-o", "pid,comm,args"}
	}

	args := []string{}
	parts := strings.Fields(safeFlags)

	for _, part := range parts {
		if isValidPsFlag(part) {
			args = append(args, part)
		}
	}

	if len(args) == 0 {
		return []string{"-e", "-o", "pid,comm,args"}
	}

	return args
}

func sanitizeFlags(flags string) string {
	allowedChars := regexp.MustCompile(`^[a-zA-Z0-9\s\-,=]+$`)
	if !allowedChars.MatchString(flags) {
		return ""
	}
	return flags
}

func isValidPsFlag(flag string) bool {
	validFlags := map[string]bool{
		"-e": true, "-f": true, "-l": true, "-a": true, "-u": true,
		"-x": true, "-A": true, "-T": true, "aux": true, "-aux": true,
		"ax": true, "-ax": true, "ef": true, "-ef": true,
	}

	if validFlags[flag] {
		return true
	}

	if strings.HasPrefix(flag, "-o") || strings.HasPrefix(flag, "--format") {
		return true
	}

	if strings.HasPrefix(flag, "-") && len(flag) <= 10 {
		for _, ch := range flag[1:] {
			if !strings.ContainsRune("aAdefFluxwT", ch) {
				return false
			}
		}
		return true
	}

	return false
}

func extractPID(line string) int {
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return 0
	}

	pid, err := strconv.Atoi(fields[0])
	if err != nil {
		return 0
	}

	return pid
}
</CODE>