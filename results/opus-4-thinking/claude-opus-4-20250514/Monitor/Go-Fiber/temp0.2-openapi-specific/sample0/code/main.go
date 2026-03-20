package main

import (
    "bytes"
    "context"
    "log"
    "os/exec"
    "regexp"
    "strconv"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/logger"
    "github.com/gofiber/fiber/v2/middleware/recover"
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
    app := fiber.New(fiber.Config{
        ErrorHandler: customErrorHandler,
    })

    // Add security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Use(logger.New())
    app.Use(recover.New())

    app.Post("/monitor/commands", handleMonitorCommands)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
    code := fiber.StatusInternalServerError
    
    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
    }

    // Don't expose internal error details
    return c.Status(code).JSON(ErrorResponse{
        Code:    code,
        Message: "An error occurred processing your request",
    })
}

func handleMonitorCommands(c *fiber.Ctx) error {
    var req MonitorRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Code:    400,
            Message: "Invalid request body",
        })
    }

    // Validate required fields
    if req.CommandRegex == "" {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Code:    400,
            Message: "command_regex is required",
        })
    }

    // Compile regex first to validate it
    regex, err := regexp.Compile(req.CommandRegex)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Code:    400,
            Message: "Invalid regular expression",
        })
    }

    // Sanitize and validate filter flags to prevent command injection
    // Only allow specific safe flags
    allowedFlags := map[string]bool{
        "a": true, "u": true, "x": true, "e": true, "f": true,
        "l": true, "w": true, "r": true, "T": true,
    }

    var safeFlags []string
    if req.FilterFlags != "" {
        // Remove any dash prefixes and split by spaces
        flagParts := strings.Fields(req.FilterFlags)
        for _, part := range flagParts {
            // Remove leading dashes
            cleanFlag := strings.TrimLeft(part, "-")
            // Check each character in the flag
            for _, char := range cleanFlag {
                if allowedFlags[string(char)] {
                    safeFlags = append(safeFlags, string(char))
                }
            }
        }
    }

    // Build ps command with safe flags
    args := []string{}
    if len(safeFlags) > 0 {
        args = append(args, "-"+strings.Join(safeFlags, ""))
    }

    // Execute ps command with timeout to prevent resource exhaustion
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    cmd := exec.CommandContext(ctx, "ps", args...)
    
    var stdout, stderr bytes.Buffer
    cmd.Stdout = &stdout
    cmd.Stderr = &stderr

    if err := cmd.Run(); err != nil {
        // Check if it was a timeout
        if ctx.Err() == context.DeadlineExceeded {
            return c.Status(fiber.StatusRequestTimeout).JSON(ErrorResponse{
                Code:    408,
                Message: "Request timeout",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
            Code:    500,
            Message: "Failed to execute process listing",
        })
    }

    // Parse ps output
    lines := strings.Split(stdout.String(), "\n")
    var processes []ProcessInfo

    for i, line := range lines {
        if i == 0 || line == "" {
            // Skip header and empty lines
            continue
        }

        // Try to extract PID - it's usually in the first or second field
        fields := strings.Fields(line)
        if len(fields) == 0 {
            continue
        }

        var pid int
        var pidFound bool
        
        // Try first two fields for PID
        for j := 0; j < 2 && j < len(fields); j++ {
            if p, err := strconv.Atoi(fields[j]); err == nil {
                pid = p
                pidFound = true
                break
            }
        }

        if !pidFound {
            continue
        }

        // For command matching, we'll look for the command part in the line
        // In most ps outputs, the command is after some fixed fields
        // We'll be conservative and check if the regex matches anywhere in the line
        // This works well since command strings are usually distinctive
        if regex.MatchString(line) {
            processes = append(processes, ProcessInfo{
                ProcessID:     pid,
                ProcessString: line,
            })
        }
    }

    return c.JSON(processes)
}