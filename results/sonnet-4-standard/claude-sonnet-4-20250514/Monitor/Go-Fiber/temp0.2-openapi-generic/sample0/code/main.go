package main

import (
	"encoding/json"
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
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
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{
				Code:    code,
				Message: err.Error(),
			})
		},
	})

	app.Use(recover.New())
	app.Use(cors.New())

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    fiber.StatusBadRequest,
			Message: "Invalid JSON format",
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

func getProcesses(filterFlags string, commandRegex *regexp.Regexp) ([]ProcessInfo, error) {
	var args []string
	if filterFlags != "" {
		args = strings.Fields(filterFlags)
	} else {
		args = []string{"aux"}
	}

	cmd := exec.Command("ps", args...)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	lines := strings.Split(string(output), "\n")
	var processes []ProcessInfo

	for i, line := range lines {
		if i == 0 || line == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 11 {
			continue
		}

		commandLine := strings.Join(fields[10:], " ")
		if commandRegex.MatchString(commandLine) {
			pid, err := strconv.Atoi(fields[1])
			if err != nil {
				continue
			}

			processes = append(processes, ProcessInfo{
				ProcessID:     pid,
				ProcessString: line,
			})
		}
	}

	return processes, nil
}