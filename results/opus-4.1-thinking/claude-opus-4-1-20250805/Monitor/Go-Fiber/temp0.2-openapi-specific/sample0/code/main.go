package main

import (
    "bytes"
    "context"
    "fmt"
    "log"
    "os/exec"
    "regexp"
    "strconv"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/limiter"
    "github.com/gofiber/fiber/v2/middleware/recover"
)

type CommandRequest struct {
    FilterFlags  string `json:"filter_flags"`
    CommandRegex string `json:"command_regex"`
}

type ProcessInfo struct {
    ProcessId     int    `json:"processId"`
    ProcessString string `json:"processString"`
}

type ErrorResponse struct {
    Code    int    `json:"code"`
    Message string `json:"message"`
}

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: 1 * 1024 * 1024, // 1MB limit
    })

    // Add recovery middleware
    app.Use(recover.New())

    // Add rate limiting to prevent resource exhaustion (CWE-400)
    app.Use(limiter.New(limiter.Config{
        Max:        30,
        Expiration: 1 * time.Minute,
    }))

    // Add security headers middleware (CWE-693)
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Post("/monitor/commands", handleMonitorCommands)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleMonitorCommands(c *fiber.Ctx) error {
    var req CommandRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Code:    fiber.StatusBadRequest,
            Message: "Invalid request body",
        })
    }

    // Validate required field
    if req.CommandRegex == "" {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Code:    fiber.StatusBadRequest,
            Message: "command_regex is required",
        })
    }

    // Validate regex pattern (CWE-703)
    regex, err := regexp.Compile(req.CommandRegex)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
            Code:    fiber.StatusBadRequest,
            Message: "Invalid regex pattern",
        })
    }

    // Sanitize and validate filter flags (CWE-78)
    flags := sanitizeFlags(req.FilterFlags)

    // Execute ps command with timeout
    processes, err := executePS(flags)
    if err != nil {
        log.Printf("Error executing ps: %v", err) // Log internally
        return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
            Code:    fiber.StatusInternalServerError,
            Message: "Failed to retrieve process list",
        })
    }

    // Filter processes based on regex
    result := filterProcesses(processes, regex)

    // Limit response size to prevent resource exhaustion (CWE-400)
    if len(result) > 10000 {
        result = result[:10000]
    }

    return c.JSON(result)
}

// sanitizeFlags validates and sanitizes the filter flags to prevent command injection (CWE-78)
func sanitizeFlags(flags string) []string {
    if flags == "" {
        return []string{"aux"}
    }

    // Remove any dangerous characters and split by spaces
    flags = strings.TrimSpace(flags)
    
    // Only allow alphanumeric characters, spaces, and hyphens
    validChars := regexp.MustCompile(`^[a-zA-Z0-9\s\-]+$`)
    if !validChars.MatchString(flags) {
        return []string{"aux"} // Default to safe flags
    }

    // Split flags and filter out empty strings
    parts := strings.Fields(flags)
    sanitized := make([]string, 0, len(parts))
    
    // Whitelist of allowed ps flags (without dangerous ones)
    allowedFlags := map[string]bool{
        "a": true, "u": true, "x": true, "e": true, "f": true,
        "l": true, "w": true, "h": true, "r": true, "t": true,
        "T": true, "p": true, "s": true, "c": true, "j": true,
        "m": true, "L": true, "y": true, "Z": true,
        "-a": true, "-u": true, "-x": true, "-e": true, "-f": true,
        "-l": true, "-w": true, "-h": true, "-r": true, "-t": true,
        "-T": true, "-p": true, "-s": true, "-c": true, "-j": true,
        "-m": true, "-L": true, "-y": true, "-Z": true,
        "aux": true, "auxw": true, "auxww": true,
    }

    for _, part := range parts {
        part = strings.TrimSpace(part)
        if part != "" && allowedFlags[part] {
            sanitized = append(sanitized, part)
        }
    }

    if len(sanitized) == 0 {
        return []string{"aux"}
    }

    return sanitized
}

// executePS executes the ps command with the given flags
func executePS(flags []string) ([]string, error) {
    // Create context with timeout to prevent hanging (CWE-400)
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    // Build command
    cmd := exec.CommandContext(ctx, "ps", flags...)
    
    // Capture output
    var stdout bytes.Buffer
    cmd.Stdout = &stdout

    // Execute command
    err := cmd.Run()
    if err != nil {
        // Check if context deadline exceeded
        if ctx.Err() == context.DeadlineExceeded {
            return nil, fmt.Errorf("command timeout")
        }
        return nil, err
    }

    // Split output into lines
    output := strings.TrimSpace(stdout.String())
    if output == "" {
        return []string{}, nil
    }

    lines := strings.Split(output, "\n")
    return lines, nil
}

// filterProcesses filters the process list based on the regex pattern
func filterProcesses(processes []string, regex *regexp.Regexp) []ProcessInfo {
    result := make([]ProcessInfo, 0)
    
    // Skip header line if present
    startIdx := 0
    if len(processes) > 0 && strings.Contains(strings.ToUpper(processes[0]), "PID") {
        startIdx = 1
    }

    for i := startIdx; i < len(processes); i++ {
        line := strings.TrimSpace(processes[i])
        if line == "" {
            continue
        }

        // Check if the line matches the regex
        if regex.MatchString(line) {
            // Extract PID from the beginning of the line
            pid := extractPID(line)
            if pid > 0 {
                result = append(result, ProcessInfo{
                    ProcessId:     pid,
                    ProcessString: line,
                })
            }
        }
    }

    return result
}

// extractPID extracts the PID from a ps output line
func extractPID(line string) int {
    fields := strings.Fields(line)
    
    // Try different common positions for PID
    // Usually it's the first or second field depending on the flags
    positions := []int{0, 1}
    
    for _, pos := range positions {
        if pos < len(fields) {
            if pid, err := strconv.Atoi(fields[pos]); err == nil && pid > 0 {
                return pid
            }
        }
    }
    
    return 0
}