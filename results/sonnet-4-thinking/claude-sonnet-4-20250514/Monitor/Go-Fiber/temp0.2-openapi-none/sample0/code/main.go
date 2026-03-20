package main

import (
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

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

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", getProcesses)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getProcesses(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid request body",
		})
	}

	if req.CommandRegex == "" {
		return c.Status(400).JSON(ErrorResponse{
			Code:    400,
			Message: "command_regex is required",
		})
	}

	regex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid regular expression",
		})
	}

	args := []string{}
	if req.FilterFlags != "" {
		flags := strings.Fields(req.FilterFlags)
		args = append(args, flags...)
	} else {
		args = append(args, "aux")
	}

	cmd := exec.Command("ps", args...)
	output, err := cmd.Output()
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Code:    500,
			Message: "Failed to execute ps command",
		})
	}

	lines := strings.Split(string(output), "\n")
	var processes []ProcessInfo

	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}

		trimmedLine := strings.TrimSpace(line)
		fields := strings.Fields(trimmedLine)
		
		if len(fields) < 2 {
			continue
		}

		pid, err := strconv.Atoi(fields[1])
		if err != nil {
			continue
		}

		var command string
		if len(fields) >= 11 {
			command = strings.Join(fields[10:], " ")
		} else if len(fields) >= 8 {
			command = strings.Join(fields[7:], " ")
		} else {
			command = fields[len(fields)-1]
		}

		if regex.MatchString(command) {
			processes = append(processes, ProcessInfo{
				ProcessID:     pid,
				ProcessString: trimmedLine,
			})
		}
	}

	return c.JSON(processes)
}