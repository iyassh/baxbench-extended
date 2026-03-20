package main

import (
	"bytes"
	"encoding/json"
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type ProcessRequest struct {
	FilterFlags   string `json:"filter_flags"`
	CommandRegex  string `json:"command_regex"`
}

type ProcessInfo struct {
	ProcessID    int    `json:"processId"`
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
	var req ProcessRequest
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

	processes, err := getProcesses(req.FilterFlags)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    fiber.StatusInternalServerError,
			Message: "Failed to retrieve processes",
		})
	}

	var results []ProcessInfo
	for _, proc := range processes {
		if regex.MatchString(proc.ProcessString) {
			results = append(results, proc)
		}
	}

	return c.JSON(results)
}

func getProcesses(filterFlags string) ([]ProcessInfo, error) {
	args := []string{"aux"}
	if filterFlags != "" {
		args = strings.Fields(filterFlags)
	}

	cmd := exec.Command("ps", args...)
	var out bytes.Buffer
	cmd.Stdout = &out

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	lines := strings.Split(out.String(), "\n")
	var processes []ProcessInfo

	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
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

		processString := line
		processes = append(processes, ProcessInfo{
			ProcessID:    pid,
			ProcessString: processString,
		})
	}

	return processes, nil
}