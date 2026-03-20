package main

import (
    "bufio"
    "fmt"
    "log"
    "os/exec"
    "regexp"
    "strconv"
    "strings"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/cors"
    "github.com/gofiber/fiber/v2/middleware/recover"
)

type MonitorRequest struct {
    FilterFlags   string `json:"filter_flags"`
    CommandRegex  string `json:"command_regex"`
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
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return ctx.Status(code).JSON(ErrorResponse{
                Code:    code,
                Message: err.Error(),
            })
        },
    })

    app.Use(recover.New())
    app.Use(cors.New())

    app.Post("/monitor/commands", monitorCommands)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func monitorCommands(c *fiber.Ctx) error {
    var req MonitorRequest
    if err := c.BodyParser(&req); err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid JSON body")
    }

    if req.CommandRegex == "" {
        return fiber.NewError(fiber.StatusBadRequest, "command_regex is required")
    }

    if len(req.CommandRegex) > 200 {
        return fiber.NewError(fiber.StatusBadRequest, "command_regex too long")
    }
    
    commandRegex, err := regexp.Compile(req.CommandRegex)
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid regular expression")
    }

    filterFlags := sanitizeFilterFlags(req.FilterFlags)
    
    processes, err := getProcesses(filterFlags)
    if err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Failed to get process list")
    }

    var result []ProcessInfo
    for _, process := range processes {
        if commandRegex.MatchString(process.ProcessString) {
            result = append(result, process)
        }
    }

    return c.JSON(result)
}

func sanitizeFilterFlags(flags string) string {
    if flags == "" {
        return "aux"
    }
    
    allowedChars := regexp.MustCompile(`[^a-zA-Z0-9\s\-]`)
    sanitized := allowedChars.ReplaceAllString(flags, "")
    
    if len(sanitized) > 50 {
        sanitized = sanitized[:50]
    }
    
    if strings.TrimSpace(sanitized) == "" {
        return "aux"
    }
    
    return sanitized
}

func getProcesses(filterFlags string) ([]ProcessInfo, error) {
    args := strings.Fields(filterFlags)
    cmd := exec.Command("ps", args...)
    output, err := cmd.Output()
    if err != nil {
        return nil, err
    }

    var processes []ProcessInfo
    scanner := bufio.NewScanner(strings.NewReader(string(output)))
    
    if scanner.Scan() {
        // Skip header line
    }
    
    for scanner.Scan() {
        line := scanner.Text()
        if line == "" {
            continue
        }
        
        process, err := parseProcessLine(line)
        if err == nil {
            processes = append(processes, process)
        }
    }

    return processes, nil
}

func parseProcessLine(line string) (ProcessInfo, error) {
    fields := strings.Fields(line)
    if len(fields) < 2 {
        return ProcessInfo{}, fmt.Errorf("invalid process line")
    }
    
    pid, err := strconv.Atoi(fields[1])
    if err != nil {
        pid, err = strconv.Atoi(fields[0])
        if err != nil {
            return ProcessInfo{}, fmt.Errorf("could not parse PID")
        }
    }

    return ProcessInfo{
        ProcessId:     pid,
        ProcessString: line,
    }, nil
}