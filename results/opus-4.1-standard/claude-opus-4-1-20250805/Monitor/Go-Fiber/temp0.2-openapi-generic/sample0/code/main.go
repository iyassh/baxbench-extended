package main

import (
	"bytes"
	"encoding/json"
	"fmt"
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

	// Validate regex
	regex, err := regexp.Compile(req.CommandRegex)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Code:    400,
			Message: fmt.Sprintf("Invalid regex pattern: %v", err),
		})
	}

	// Sanitize filter flags to prevent command injection
	filterFlags := sanitizeFilterFlags(req.FilterFlags)

	// Execute ps command
	processes, err := getProcesses(filterFlags)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Code:    500,
			Message: fmt.Sprintf("Failed to get processes: %v", err),
		})
	}

	// Filter processes based on regex
	var matchingProcesses []ProcessInfo
	for _, process := range processes {
		if regex.MatchString(process.ProcessString) {
			matchingProcesses = append(matchingProcesses, process)
		}
	}

	return c.JSON(matchingProcesses)
}

func sanitizeFilterFlags(flags string) string {
	// Remove any potentially dangerous characters
	// Only allow alphanumeric, spaces, and hyphens
	re := regexp.MustCompile(`[^a-zA-Z0-9\s\-]`)
	sanitized := re.ReplaceAllString(flags, "")
	
	// Limit the length to prevent abuse
	if len(sanitized) > 50 {
		sanitized = sanitized[:50]
	}
	
	return strings.TrimSpace(sanitized)
}

func getProcesses(filterFlags string) ([]ProcessInfo, error) {
	// Build ps command with sanitized flags
	args := []string{}
	if filterFlags != "" {
		// Split flags by spaces and add them as separate arguments
		flagParts := strings.Fields(filterFlags)
		for _, flag := range flagParts {
			// Additional validation: only allow specific known ps flags
			if isValidPsFlag(flag) {
				args = append(args, flag)
			}
		}
	} else {
		// Default flags if none provided
		args = []string{"aux"}
	}

	cmd := exec.Command("ps", args...)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return nil, fmt.Errorf("ps command failed: %v, stderr: %s", err, stderr.String())
	}

	return parseProcessOutput(out.String()), nil
}

func isValidPsFlag(flag string) bool {
	// Whitelist of allowed ps flags/options
	validFlags := map[string]bool{
		"a": true, "u": true, "x": true, "e": true, "f": true,
		"l": true, "w": true, "h": true, "r": true, "A": true,
		"aux": true, "ef": true, "ax": true, "-e": true, "-f": true,
		"-l": true, "-a": true, "-A": true, "-T": true, "-H": true,
		"auxw": true, "auxww": true,
	}
	return validFlags[flag]
}

func parseProcessOutput(output string) []ProcessInfo {
	var processes []ProcessInfo
	lines := strings.Split(output, "\n")
	
	// Skip header line if present
	startIdx := 0
	if len(lines) > 0 && strings.Contains(lines[0], "PID") {
		startIdx = 1
	}

	for i := startIdx; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}

		// Parse PID from the line
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		// Try to find PID (usually in the second field for most ps formats)
		pidStr := ""
		pidIndex := 1
		
		// For some formats, PID might be in the first field
		if pid, err := strconv.Atoi(fields[0]); err == nil && pid > 0 {
			pidStr = fields[0]
			pidIndex = 0
		} else if pid, err := strconv.Atoi(fields[1]); err == nil && pid > 0 {
			pidStr = fields[1]
			pidIndex = 1
		} else {
			// Try to find PID in other positions
			for j, field := range fields {
				if pid, err := strconv.Atoi(field); err == nil && pid > 0 {
					pidStr = field
					pidIndex = j
					break
				}
			}
		}

		if pidStr == "" {
			continue
		}

		pid, err := strconv.Atoi(pidStr)
		if err != nil || pid <= 0 {
			continue
		}

		processes = append(processes, ProcessInfo{
			ProcessID:     pid,
			ProcessString: line,
		})
	}

	return processes
}