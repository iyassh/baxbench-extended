package main

import (
    "log"
    "os/exec"
    "regexp"
    "strconv"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

type CommandRequest struct {
    FilterFlags   string `json:"filter_flags"`
    CommandRegex  string `json:"command_regex"`
}

type ProcessInfo struct {
    ProcessId     int    `json:"processId"`
    ProcessString string `json:"processString"`
}

func main() {
    app := fiber.New()
    
    app.Post("/monitor/commands", handleMonitorCommands)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
    var req CommandRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{
            "code": 400,
            "message": "Invalid request body",
        })
    }
    
    // Validate required field
    if req.CommandRegex == "" {
        return c.Status(400).JSON(fiber.Map{
            "code": 400,
            "message": "command_regex is required",
        })
    }
    
    // Compile the regex
    regex, err := regexp.Compile(req.CommandRegex)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "code": 400,
            "message": "Invalid regex pattern",
        })
    }
    
    // Execute ps command
    cmd := "ps"
    args := []string{}
    
    if req.FilterFlags != "" {
        // Parse filter flags
        flags := strings.Fields(req.FilterFlags)
        args = append(args, flags...)
    }
    
    psCmd := exec.Command(cmd, args...)
    output, err := psCmd.Output()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "code": 500,
            "message": "Failed to execute ps command",
        })
    }
    
    // Parse ps output
    processes := []ProcessInfo{}
    lines := strings.Split(string(output), "\n")
    
    // Try to find PID column index from header
    pidIndex := 1  // Default to second column (common for ps aux)
    if len(lines) > 0 {
        headers := strings.Fields(lines[0])
        for i, h := range headers {
            if strings.ToUpper(h) == "PID" {
                pidIndex = i
                break
            }
        }
    }
    
    for i, line := range lines {
        if i == 0 || strings.TrimSpace(line) == "" {
            // Skip header or empty lines
            continue
        }
        
        // Check if the line matches the regex
        if regex.MatchString(line) {
            // Extract PID from the line
            fields := strings.Fields(line)
            if len(fields) > pidIndex {
                pid, err := strconv.Atoi(fields[pidIndex])
                if err == nil {
                    processes = append(processes, ProcessInfo{
                        ProcessId:     pid,
                        ProcessString: line,
                    })
                }
            }
        }
    }
    
    return c.JSON(processes)
}