package main

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
)

type CalculatorRequest struct {
	Expression string `json:"expression"`
}

type CalculatorResponse struct {
	Result string `json:"result"`
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req CalculatorRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		result, err := evaluateExpression(req.Expression)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		return c.JSON(CalculatorResponse{
			Result: fmt.Sprintf("%g", result),
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func evaluateExpression(expr string) (float64, error) {
	expr = strings.ReplaceAll(expr, " ", "")
	if expr == "" {
		return 0, fmt.Errorf("empty expression")
	}
	return parseAddSub(expr)
}

func parseAddSub(expr string) (float64, error) {
	left, rest, err := parseMulDiv(expr)
	if err != nil {
		return 0, err
	}

	for len(rest) > 0 {
		op := rest[0]
		if op != '+' && op != '-' {
			break
		}
		right, newRest, err := parseMulDiv(rest[1:])
		if err != nil {
			return 0, err
		}
		if op == '+' {
			left = left + right
		} else {
			left = left - right
		}
		rest = newRest
	}

	if len(rest) > 0 {
		return 0, fmt.Errorf("unexpected characters: %s", rest)
	}

	return left, nil
}

func parseMulDiv(expr string) (float64, string, error) {
	left, rest, err := parsePrimary(expr)
	if err != nil {
		return 0, "", err
	}

	for len(rest) > 0 {
		op := rest[0]
		if op != '*' && op != '/' {
			break
		}
		right, newRest, err := parsePrimary(rest[1:])
		if err != nil {
			return 0, "", err
		}
		if op == '*' {
			left = left * right
		} else {
			if right == 0 {
				return 0, "", fmt.Errorf("division by zero")
			}
			left = left / right
		}
		rest = newRest
	}

	return left, rest, nil
}

func parsePrimary(expr string) (float64, string, error) {
	if len(expr) == 0 {
		return 0, "", fmt.Errorf("unexpected end of expression")
	}

	if expr[0] == '(' {
		result, rest, err := parseAddSubWithRest(expr[1:])
		if err != nil {
			return 0, "", err
		}
		if len(rest) == 0 || rest[0] != ')' {
			return 0, "", fmt.Errorf("missing closing parenthesis")
		}
		return result, rest[1:], nil
	}

	if expr[0] == '-' || expr[0] == '+' {
		sign := 1.0
		if expr[0] == '-' {
			sign = -1.0
		}
		val, rest, err := parsePrimary(expr[1:])
		if err != nil {
			return 0, "", err
		}
		return sign * val, rest, nil
	}

	return parseNumber(expr)
}

func parseAddSubWithRest(expr string) (float64, string, error) {
	left, rest, err := parseMulDiv(expr)
	if err != nil {
		return 0, "", err
	}

	for len(rest) > 0 {
		op := rest[0]
		if op != '+' && op != '-' {
			break
		}
		right, newRest, err := parseMulDiv(rest[1:])
		if err != nil {
			return 0, "", err
		}
		if op == '+' {
			left = left + right
		} else {
			left = left - right
		}
		rest = newRest
	}

	return left, rest, nil
}

func parseNumber(expr string) (float64, string, error) {
	i := 0
	hasDot := false
	for i < len(expr) && (unicode.IsDigit(rune(expr[i])) || expr[i] == '.') {
		if expr[i] == '.' {
			if hasDot {
				return 0, "", fmt.Errorf("invalid number format")
			}
			hasDot = true
		}
		i++
	}

	if i == 0 {
		return 0, "", fmt.Errorf("expected number")
	}

	num, err := strconv.ParseFloat(expr[:i], 64)
	if err != nil {
		return 0, "", err
	}

	return num, expr[i:], nil
}