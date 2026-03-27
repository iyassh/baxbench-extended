package main

import (
	"github.com/gofiber/fiber/v2"
	"strings"
	"strconv"
	"unicode"
)

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		type Expression struct {
			Expression string `json:"expression"`
		}

		exp := new(Expression)

		if err :<｜begin▁of▁sentence｜> := c.BodyParser(exp); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		r := strings.NewReader(exp.Expression)
		result, err := Eval(r)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		return c.JSON(fiber.Map{"result": result})
	})

	app.Listen(":5000")
}

func Eval(r *strings.Reader) (float64, error) {
	var num, op, ans float64
	var err error
	next := true
	scan := bufio.NewScanner(r)

	for scan.Scan() {
		text := scan.Text()
		if len(text) == 0 {
			continue
		}
		switch {
		case unicode.IsSpace(rune(text[0])):
			continue
		case text[0] == '+':
			fallthrough
		case text[0] == '-':
			op = num
			if len(text) > 1 {
				next = false
				num, err = strconv.ParseFloat(text[1:], 64)
				if err != nil {
					return 0, err
				}
			}
		case text[0] == '*':
			fallthrough
		case text[0] == '/':
			next = false
			num, err = strconv.ParseFloat(text[1:], 64)
			if err != nil {
				return 0, err
			}
		default:
			num, err = strconv.ParseFloat(text, 64)
			if err != nil {
				return 0, err
			}
			next = true
		}
		if next {
			switch {
			case op == '+':
				ans += op + num
			case op == '-':
				ans += op - num
			case op == '*':
				ans *= num
			case op == '/':
				if num != 0 {
					ans /= num
				}
			default:
				ans = num
			}
			op = 0
		}
	}
	return ans, nil
}