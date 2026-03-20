package main

import (
    "fmt"
    "log"
    "os/exec"
    "regexp"
    "strconv"
    "strings"

    "github.com/gofiber/fiber/v2"
)

type ProcessRequest struct {
    FilterFlags  string `json:"filter_flags"`
    CommandRegex string `json:"command_regex"`
}

type ProcessResponse struct {
    ProcessId     int    `json:"processId"`
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
        return c.Status(400).JSON(ErrorResponse{
            Code:    400,
            Message: "Invalid request body",
        })
    }

    // Validate required field
    if req.CommandRegex == "" {
        return c.Status(400).JSON(ErrorResponse{
            Code:    400,
            Message: "command_regex is required",
        })
    }

    // Compile the regex
    regex, err := regexp.Compile(req.CommandRegex)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{
            Code:    400,
            Message: "Invalid regex pattern",
        })
    }

    // Build ps command
    psArgs := buildPsArgs(req.FilterFlags)
    
    // Execute ps command
    cmd := exec.Command("ps", psArgs...)
    output, err := cmd.Output()
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Code:    500,
            Message: fmt.Sprintf("Failed to execute ps command: %v", err),
        })
    }

    // Parse the output
    processes := parseProcessList(string(output), regex)

    return c.JSON(processes)
}

func buildPsArgs(filterFlags string) []string {
    if filterFlags == "" {
        return []string{"aux"}
    }

    // Sanitize filter flags to prevent command injection
    var args []string
    
    // Split by spaces
    parts := strings.Fields(filterFlags)
    
    for _, part := range parts {
        // Check if it's a valid flag or argument
        if isValidPsArg(part) {
            args = append(args, part)
        }
    }

    if len(args) == 0 {
        return []string{"aux"}
    }

    return args
}

func isValidPsArg(arg string) bool {
    // Allow alphanumeric characters, hyphens, and some special ps options
    // This allows flags like -a, -u, -x, -T, aux, etc.
    validPattern := regexp.MustCompile(`^-?[a-zA-Z0-9]+$`)
    return validPattern.MatchString(arg)
}

func parseProcessList(output string, regex *regexp.Regexp) []ProcessResponse {
    lines := strings.Split(output, "\n")
    processes := []ProcessResponse{}

    // Find PID column position from header
    pidColumn := -1
    if len(lines) > 0 {
        headerFields := strings.Fields(lines[0])
        for i, field := range headerFields {
            if field == "PID" {
                pidColumn = i
                break
            }
        }
    }

    // If we couldn't find PID column, assume it's the second column (common for ps aux)
    if pidColumn == -1 {
        pidColumn = 1
    }

    // Process each line
    for i, line := range lines {
        // Skip header and empty lines
        if i == 0 || strings.TrimSpace(line) == "" {
            continue
        }

        // Check if the line matches the regex
        if regex.MatchString(line) {
            // Extract PID from the line
            fields := strings.Fields(line)
            if len(fields) > pidColumn {
                pid, err := strconv.Atoi(fields[pidColumn])
                if err == nil {
                    processes = append(processes, ProcessResponse{
                        ProcessId:     pid,
                        ProcessString: strings.TrimSpace(line),
                    })
                }
            }
        }
    }

    return processes
}