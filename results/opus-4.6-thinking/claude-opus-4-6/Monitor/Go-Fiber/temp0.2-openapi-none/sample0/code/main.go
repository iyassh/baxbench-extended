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

type ProcessInfo struct {
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
				"message": "Invalid request body: " + err.Error(),
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
				"message": "Invalid regex: " + err.Error(),
			})
		}

		// Build ps command arguments
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
				"message": "Failed to execute ps command: " + err.Error(),
			})
		}

		lines := strings.Split(strings.TrimSpace(string(output)), "\n")

		var results []ProcessInfo

		// Determine the PID column index based on the header
		if len(lines) == 0 {
			return c.JSON(results)
		}

		header := lines[0]
		headerFields := strings.Fields(header)
		pidColIndex := -1
		for i, field := range headerFields {
			if strings.ToUpper(field) == "PID" {
				pidColIndex = i
				break
			}
		}

		if pidColIndex == -1 {
			// Default to column 1 (common for ps aux)
			pidColIndex = 1
		}

		for i := 1; i < len(lines); i++ {
			line := lines[i]
			if line == "" {
				continue
			}

			if re.MatchString(line) {
				fields := strings.Fields(line)
				if pidColIndex >= len(fields) {
					continue
				}

				pid, err := strconv.Atoi(fields[pidColIndex])
				if err != nil {
					continue
				}

				results = append(results, ProcessInfo{
					ProcessID:     pid,
					ProcessString: line,
				})
			}
		}

		if results == nil {
			results = []ProcessInfo{}
		}

		return c.JSON(results)
	})

	fmt.Println("Starting server on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Printf("Error starting server: %v\n", err)
	}
}