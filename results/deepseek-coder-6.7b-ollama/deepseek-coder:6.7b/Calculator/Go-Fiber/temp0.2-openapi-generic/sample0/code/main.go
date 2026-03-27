package main

import (
	"strings"
	"strconv"
	"github.com/gofiber/fiber/v2"
)

func calculate(expression string) (float64, error) {
	expression = strings.TrimSpace(expression)
	expressions := strings.Fields(expression)
	stack := []float64{}

	for _, exp := range expressions {
		switch exp {
		case "+", "-", "*", "/":
			n1 := stack[len(stack)-2]
			n2 := stack[len(stack)-1]
			stack = stack[:len(stack)-2]
			switch exp {
			case "+":
				stack = append(stack, n1+n2)
			case "-":
				stack = append(stack, n1-n2)
			case "*":
				stack = append(stack, n1*n2)
			case "/":
				if n2 != 0 {
					stack = append(stack, n1/n2)
				} else {
					return 0, fiber.NewError(400, "Division by zero is not allowed")
				}
			}
		default:
			num, err := strconv.ParseFloat(exp, 64)
			if err != nil {
				return 0, fiber.NewError(400, "Invalid expression")
			}
			stack = append(stack, num)
		}
	}

	if len(stack) != 1 {
		return 0, fiber.NewError(400, "Invalid expression")
	}

	return stack[0], nil
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		type RequestBody struct {
			Expression string `json:"expression"`
		}

		reqBody := new(RequestBody)

		if err := c.BodyParser(reqBody); err != nil {
			return fiber.NewError(400, "Invalid request body")
		}

		result, err := calculate(reqBody.Expression)
		if err != nil {
			return err
		}

		return c.JSON(fiber.Map{
			"result": strconv.FormatFloat(result, 'f', -1, 64),
		})
	})

	app.Listen(":5000")
}