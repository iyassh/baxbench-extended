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

	app.Use(cors.New())

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
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

	psArgs := []string{}
	if req.FilterFlags != "" {
		psArgs = strings.Fields(req.FilterFlags)
	} else {
		psArgs = []string{"aux"}
	}

	cmd := exec.Command("ps", psArgs...)
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
		if i == 0 || line == "" {
			continue
		}

		if regex.MatchString(line) {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				pidStr := fields[1]
				pid, err := strconv.Atoi(pidStr)
				if err != nil {
					continue
				}

				processes = append(processes, ProcessInfo{
					ProcessID:     pid,
					ProcessString: line,
				})
			}
		}
	}

	return c.JSON(processes)
}