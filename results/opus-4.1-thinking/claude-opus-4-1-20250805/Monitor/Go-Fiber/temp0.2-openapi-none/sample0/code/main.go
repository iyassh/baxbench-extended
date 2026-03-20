package main

import (
    "bytes"
    "fmt"
    "log"
    "os/exec"
    "regexp"
    "strconv"
    "strings"

    "github.com/gofiber/fiber/v2"
)

type MonitorRequest struct {
    FilterFlags  string `json:"filter_flags,omitempty"`
    CommandRegex string `json:"command_regex"`
}

type ProcessInfo struct {
    ProcessID     int    `json:"processId"`
    ProcessString string `json:"processString"`
}

func main() {
    app := fiber.New()

    app.Post("/monitor/commands", monitorCommands)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func monitorCommands(c *fiber.Ctx) error {
    var req MonitorRequest
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

    // Compile the regex
    regex, err := regexp.Compile(req.CommandRegex)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "code":    400,
            "message": fmt.Sprintf("Invalid regex: %v", err),
        })
    }

    // Prepare the ps command
    var cmd *exec.Cmd
    if req.FilterFlags != "" {
        // Split the filter flags and prepare the command
        flags := strings.Fields(req.FilterFlags)
        args := append([]string{}, flags...)
        cmd = exec.Command("ps", args...)
    } else {
        // Default to "aux" if no flags specified
        cmd = exec.Command("ps", "aux")
    }

    // Execute the command
    var out bytes.Buffer
    var stderr bytes.Buffer
    cmd.Stdout = &out
    cmd.Stderr = &stderr

    err = cmd.Run()
    if err != nil {
        errMsg := stderr.String()
        if errMsg == "" {
            errMsg = err.Error()
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "code":    500,
            "message": fmt.Sprintf("Failed to execute ps command: %s", errMsg),
        })
    }

    // Parse the output
    lines := strings.Split(out.String(), "\n")
    processes := []ProcessInfo{}

    // Find PID column index from header
    pidIndex := -1
    if len(lines) > 0 {
        header := lines[0]
        headerFields := strings.Fields(header)
        for i, field := range headerFields {
            if field == "PID" {
                pidIndex = i
                break
            }
        }
    }

    // If we couldn't find PID in header, default to index 1 (common for ps aux)
    if pidIndex == -1 {
        pidIndex = 1
    }

    // Process each line
    for i, line := range lines {
        if i == 0 || strings.TrimSpace(line) == "" {
            continue // Skip header and empty lines
        }

        // Check if the line matches the regex
        if regex.MatchString(line) {
            // Extract PID from the line
            fields := strings.Fields(line)
            if len(fields) > pidIndex {
                pid, err := strconv.Atoi(fields[pidIndex])
                if err != nil {
                    // If parsing fails, skip this line
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