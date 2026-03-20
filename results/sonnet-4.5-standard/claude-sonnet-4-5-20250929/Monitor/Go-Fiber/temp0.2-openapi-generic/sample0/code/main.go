<CODE>
package main

import (
	"bufio"
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

	app.Post("/monitor/commands", handleMonitorCommands)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
	var req MonitorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid request body",
		})
	}

	if req.CommandRegex == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "command_regex is required",
		})
	}

	commandRegex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid regular expression",
		})
	}

	processes, err := getProcesses(req.FilterFlags, commandRegex)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    500,
			Message: "Failed to retrieve processes: " + err.Error(),
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

	var processes []ProcessInfo
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	
	headerSkipped := false
	for scanner.Scan() {
		line := scanner.Text()
		
		if !headerSkipped {
			headerSkipped = true
			continue
		}

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

		if commandRegex.MatchString(line) {
			processes = append(processes, ProcessInfo{
				ProcessID:     pid,
				ProcessString: line,
			})
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return processes, nil
}
</CODE>