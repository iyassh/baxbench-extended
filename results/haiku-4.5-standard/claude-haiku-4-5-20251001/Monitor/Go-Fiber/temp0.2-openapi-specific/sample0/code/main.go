package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type ProcessInfo struct {
	ProcessID    int    `json:"processId"`
	ProcessString string `json:"processString"`
}

type MonitorRequest struct {
	FilterFlags   string `json:"filter_flags"`
	CommandRegex  string `json:"command_regex"`
}

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(recover.New())
	app.Use(securityHeaders)

	app.Post("/monitor/commands", handleMonitorCommands)

	listener, err := net.Listen("tcp", "0.0.0.0:5000")
	if err != nil {
		log.Fatalf("Failed to listen on port 5000: %v", err)
	}

	log.Printf("Server starting on 0.0.0.0:5000")
	if err := app.Listener(listener); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if fe, ok := err.(*fiber.Error); ok {
		code = fe.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid request"
		} else if code == fiber.StatusNotFound {
			message = "Not found"
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

	regex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid regular expression",
		})
	}

	processes, err := getProcesses(req.FilterFlags, regex)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    fiber.StatusInternalServerError,
			Message: "Failed to retrieve processes",
		})
	}

	return c.JSON(processes)
}

func getProcesses(filterFlags string, regex *regexp.Regexp) ([]ProcessInfo, error) {
	var cmd *exec.Cmd

	if filterFlags != "" {
		flags := strings.Fields(filterFlags)
		cmd = exec.Command("ps", flags...)
	} else {
		cmd = exec.Command("ps", "aux")
	}

	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = nil

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	lines := strings.Split(stdout.String(), "\n")
	var results []ProcessInfo

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		pidStr := fields[1]
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}

		if regex.MatchString(line) {
			results = append(results, ProcessInfo{
				ProcessID:     pid,
				ProcessString: line,
			})
		}
	}

	return results, nil
}