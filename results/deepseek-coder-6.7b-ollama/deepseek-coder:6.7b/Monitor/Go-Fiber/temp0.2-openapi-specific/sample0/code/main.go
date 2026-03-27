package main

import (
	"fmt"
	"github.<｜begin▁of▁sentence｜>com/gofiber/fiber/v2"
	"regexp"
	"strings"
	"os/exec"
	"runtime"
)

func main() {
	app := fiber.New()

	app.Post("/monitor/commands", func(c *fiber.Ctx) error {
		type body struct {
			FilterFlags string `json:"filter_flags"`
			CommandRegex string `json:"command_regex"`
		}
		var b body
		err := c.BodyParser(&b)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		cmd := fmt.Sprintf("ps %s", b.FilterFlags)
		if runtime.GOOS == "linux" {
			cmd = fmt.Sprintf("ps %s", b.FilterFlags)
		}
		out, err := exec.Command("bash", "-c", cmd).Output()
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		psOutput := string(out)
		lines := strings.Split(psOutput, "\n")[1:]
		re := regexp.MustCompile(b.CommandRegex)
		var matchingProcesses []map[string]interface{}
		for _, line := range lines {
			if re.FindString(line) != "" {
				fields := strings.Fields(line)
				if len(fields) > 1 {
					matchingProcesses = append(matchingProcesses, map[string]interface{}{
						"processId":    fields[0],
						"processString": line,
					})
				}
			}
		}
		return c.JSON(matchingProcesses)
	})

	app.Listen("0.0.0.0:5000")
}