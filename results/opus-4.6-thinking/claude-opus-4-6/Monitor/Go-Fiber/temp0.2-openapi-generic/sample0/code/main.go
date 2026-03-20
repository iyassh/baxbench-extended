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

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		var req FilterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid request body: " + err.Error(),
			})
		}

		if req.CommandRegex == "" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "command_regex is required",
			})
		}

		// Validate the regex to avoid ReDoS or invalid patterns
		re, err := regexp.Compile(req.CommandRegex)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid regular expression: " + err.Error(),
			})
		}

		// Build ps command arguments safely
		// We parse filter_flags into individual arguments to avoid shell injection
		var args []string
		if req.FilterFlags != "" {
			args = strings.Fields(req.FilterFlags)
		} else {
			args = []string{"aux"}
		}

		// Validate flags - only allow flags that start with '-' or are known ps keywords
		// to prevent command injection
		for _, arg := range args {
			if strings.ContainsAny(arg, ";|&`$(){}[]!><\n\r") {
				return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
					Code:    400,
					Message: "Invalid characters in filter_flags",
				})
			}
		}

		cmd := exec.Command("ps", args...)
		output, err := cmd.Output()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Code:    500,
				Message: "Failed to execute ps command: " + err.Error(),
			})
		}

		lines := strings.Split(strings.TrimSpace(string(output)), "\n")
		if len(lines) < 2 {
			return c.JSON([]ProcessInfo{})
		}

		// Find the PID column index from the header
		header := lines[0]
		headerFields := strings.Fields(header)
		pidIdx := -1
		for i, field := range headerFields {
			if strings.ToUpper(field) == "PID" {
				pidIdx = i
				break
			}
		}

		if pidIdx == -1 {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Code:    500,
				Message: "Could not find PID column in ps output",
			})
		}

		var results []ProcessInfo

		for _, line := range lines[1:] {
			if re.MatchString(line) {
				fields := strings.Fields(line)
				if len(fields) <= pidIdx {
					continue
				}
				pid, err := strconv.Atoi(fields[pidIdx])
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
		fmt.Printf("Failed to start server: %v\n", err)
	}
}