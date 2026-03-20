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
    FilterFlags  string `json:"filter_flags"`
    CommandRegex string `json:"command_regex"`
}

type ProcessInfo struct {
    ProcessID     int    `json:"processId"`
    ProcessString string `json:"processString"`
}

func main() {
    app := fiber.New()

    app.Post("/monitor/commands", monitorHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func monitorHandler(c *fiber.Ctx) error {
    var req MonitorRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "code":    400,
            "message": "Invalid request body",
        })
    }

    // Validate required field
    if req.CommandRegex == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "code":    400,
            "message": "command_regex is required",
        })
    }

    // Compile regex
    regex, err := regexp.Compile(req.CommandRegex)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "code":    400,
            "message": "Invalid regular expression",
        })
    }

    // Build ps command
    args := []string{}
    if req.FilterFlags != "" {
        // Parse flags safely
        parts := strings.Fields(req.FilterFlags)
        for _, part := range parts {
            if isValidPsArg(part) {
                args = append(args, part)
            }
        }
    } else {
        // Default flags
        args = []string{"aux"}
    }

    // Execute ps command
    cmd := exec.Command("ps", args...)
    var out bytes.Buffer
    var stderr bytes.Buffer
    cmd.Stdout = &out
    cmd.Stderr = &stderr

    err = cmd.Run()
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "code":    500,
            "message": fmt.Sprintf("Failed to execute ps command: %v", err),
        })
    }

    // Parse ps output
    lines := strings.Split(out.String(), "\n")
    processes := []ProcessInfo{}
    
    // Find PID column position
    pidIndex := findPIDIndex(lines)

    for i, line := range lines {
        if i == 0 || line == "" {
            continue
        }

        // Check regex match
        if !regex.MatchString(line) {
            continue
        }

        // Extract PID
        pid := extractPID(line, pidIndex)
        if pid > 0 {
            processes = append(processes, ProcessInfo{
                ProcessID:     pid,
                ProcessString: line,
            })
        }
    }

    return c.JSON(processes)
}

func findPIDIndex(lines []string) int {
    if len(lines) == 0 {
        return -1
    }
    
    headerFields := strings.Fields(lines[0])
    for i, field := range headerFields {
        if field == "PID" {
            return i
        }
    }
    return -1
}

func extractPID(line string, pidIndex int) int {
    fields := strings.Fields(line)
    if len(fields) < 2 {
        return 0
    }

    // Try detected index
    if pidIndex >= 0 && pidIndex < len(fields) {
        if pid, err := strconv.Atoi(fields[pidIndex]); err == nil && pid > 0 {
            return pid
        }
    }

    // Try common positions
    positions := []int{1, 0, 2}
    for _, pos := range positions {
        if pos < len(fields) {
            if pid, err := strconv.Atoi(fields[pos]); err == nil && pid > 0 {
                return pid
            }
        }
    }
    
    return 0
}

func isValidPsArg(arg string) bool {
    // Block dangerous characters
    dangerous := []string{";", "&", "|", "`", "$", "(", ")", "{", "}", "<", ">", "\\", "'", "\"", "\n", "\r"}
    for _, char := range dangerous {
        if strings.Contains(arg, char) {
            return false
        }
    }
    
    // Allow valid ps arguments
    validArg := regexp.MustCompile(`^-?[a-zA-Z0-9]+$`)
    return validArg.MatchString(arg)
}