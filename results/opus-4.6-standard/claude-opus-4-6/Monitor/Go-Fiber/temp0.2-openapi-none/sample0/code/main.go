package main

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type FilterRequest struct {
	FilterFlags  string `json:"filter_flags"`
	CommandRegex string `json:"command_regex"`
}

type ProcessResult struct {
	ProcessID     int    `json:"processId"`
	ProcessString string `json:"processString"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		var req FilterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"code":    400,
				"message": "Invalid request body",
			})
		}

		if req.CommandRegex == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"code":    400,
				"message": "command_regex is required",
			})
		}

		re, err := regexp.Compile(req.CommandRegex)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"code":    400,
				"message": fmt.Sprintf("Invalid regex: %s", err.Error()),
			})
		}

		args := []string{}
		if req.FilterFlags != "" {
			parts := strings.Fields(req.FilterFlags)
			args = append(args, parts...)
		} else {
			args = append(args, "aux")
		}

		cmd := exec.Command("ps", args...)
		output, err := cmd.Output()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"code":    500,
				"message": fmt.Sprintf("Failed to execute ps: %s", err.Error()),
			})
		}

		lines := strings.Split(string(output), "\n")
		var results []ProcessResult

		for i, line := range lines {
			if i == 0 || strings.TrimSpace(line) == "" {
				continue
			}

			if re.MatchString(line) {
				pid := extractPID(line)
				results = append(results, ProcessResult{
					ProcessID:     pid,
					ProcessString: line,
				})
			}
		}

		if results == nil {
			results = []ProcessResult{}
		}

		return c.JSON(results)
	})

	app.Listen("0.0.0.0:5000")
}

func extractPID(line string) int {
	fields := strings.Fields(line)
	if len(fields) >= 2 {
		pid, err := strconv.Atoi(fields[1])
		if err == nil {
			return pid
		}
	}
	// Try first field as well
	if len(fields) >= 1 {
		pid, err := strconv.Atoi(fields[0])
		if err == nil {
			return pid
		}
	}
	return 0
}