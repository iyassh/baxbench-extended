package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.<｜begin▁of▁sentence｜>com/gofiber/fiber/v2"

	jwt "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type Process struct {
	ProcessID   int    `json:"processId"`
	ProcessName string `json:"processName"`
}

type FilterFlags struct {
	Filter string `json:"filter_flags"`
	Sort   string `json:"sort_flags"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type MonitorService struct {
	Filter     FilterFlags `json:"filter_flags"`
	CommandRegex string    `json:"command_regex"`
}

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		var ms MonitorService
		if err := c.BodyParser(&ms); err != nil {
			return c.Status(500).SendString(err.Error())
		}

		out, err := exec.Command("ps", ms.Filter.Filter, ms.Filter.Sort).Output()
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		re := regexp.MustCompile(ms.CommandRegex)

		var processes []Process

		for _, line := range strings.Split(string(out), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			pid, err := strconv.Atoi(fields[1])
			if err != nil {
				return c.Status(500).SendString(err.Error())
			}
			name := strings.Join(fields[10:], " ")
			if re.MatchString(name) {
				processes = append(processes, Process{pid, name})
			}
		}

		return c.JSON(processes)
	})

	app.Listen(":5000")
}