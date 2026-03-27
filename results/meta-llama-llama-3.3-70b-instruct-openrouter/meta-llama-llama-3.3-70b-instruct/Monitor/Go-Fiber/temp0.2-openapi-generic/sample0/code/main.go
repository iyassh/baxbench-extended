package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// Process represents a process
type Process struct {
	ProcessID   int    `json:"processId"`
	ProcessString string `json:"processString"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		var request struct {
			FilterFlags string `json:"filter_flags"`
			CommandRegex string `json:"command_regex"`
		}

		if err := json.Unmarshal(c.Body(), &request); err != nil {
			return c.Status(400).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid request body",
			})
		}

		if request.CommandRegex == "" {
			return c.Status(400).JSON(ErrorResponse{
				Code:    400,
				Message: "Command regex is required",
			})
		}

		regex, err := regexp.Compile(request.CommandRegex)
		if err != nil {
			return c.Status(400).JSON(ErrorResponse{
				Code:    400,
				Message: "Invalid command regex",
			})
		}

		cmd := exec.Command("ps", strings.Split(request.FilterFlags, " ")...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{
				Code:    500,
				Message: "Failed to execute ps command",
			})
		}

		scanner := bufio.NewScanner(bytes.NewReader(output))
		var processes []Process
		for scanner.Scan() {
			line := scanner.Text()
			fields := strings.Fields(line)
			if len(fields) < 5 {
				continue
			}

			processID, err := strconv.Atoi(fields[0])
			if err != nil {
				continue
			}

			processString := strings.Join(fields[4:], " ")
			if regex.MatchString(processString) {
				processes = append(processes, Process{
					ProcessID:   processID,
					ProcessString: processString,
				})
			}
		}

		return c.JSON(processes)
	})

	log.Fatal(app.Listen(":5000"))
}