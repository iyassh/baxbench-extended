package main

import (
	"bufio"
	"bytes"
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

	cmdRegex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: "Invalid regular expression",
		})
	}

	psArgs := buildPsArgs(req.FilterFlags)

	cmd := exec.Command("ps", psArgs...)
	var out bytes.Buffer
	cmd.Stdout = &out

	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    500,
			Message: "Failed to execute ps command",
		})
	}

	processes := parseProcesses(out.String(), cmdRegex)

	return c.JSON(processes)
}

func buildPsArgs(filterFlags string) []string {
	if filterFlags == "" {
		return []string{"aux"}
	}

	flags := strings.TrimSpace(filterFlags)
	args := []string{}

	for _, arg := range strings.Fields(flags) {
		if isValidPsArg(arg) {
			args = append(args, arg)
		}
	}

	if len(args) == 0 {
		return []string{"aux"}
	}

	return args
}

func isValidPsArg(arg string) bool {
	matched, _ := regexp.MatchString(`^[\-a-zA-Z0-9]+$`, arg)
	return matched
}

func parseProcesses(output string, cmdRegex *regexp.Regexp) []ProcessInfo {
	processes := []ProcessInfo{}
	scanner := bufio.NewScanner(strings.NewReader(output))

	first := true

	for scanner.Scan() {
		line := scanner.Text()

		if first {
			first = false
			continue
		}

		if !cmdRegex.MatchString(line) {
			continue
		}

		pid := extractPID(line)
		if pid > 0 {
			processes = append(processes, ProcessInfo{
				ProcessID:     pid,
				ProcessString: line,
			})
		}
	}

	return processes
}

func extractPID(line string) int {
	fields := strings.Fields(line)

	if len(fields) < 2 {
		return 0
	}

	pid, err := strconv.Atoi(fields[1])
	if err != nil {
		return 0
	}

	return pid
}