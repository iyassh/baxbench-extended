package main

import (
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func evaluateExpression(expr string) (string, error) {
	// Validate input: only allow digits, operators, spaces, and parentheses
	if !regexp.MustCompile(`^[\d\s+\-*/(). ]+$`).MatchString(expr) {
		return "", fmt.Errorf("invalid characters in expression")
	}

	// Remove spaces
	expr = strings.ReplaceAll(expr, " ", "")

	// Simple recursive descent parser for arithmetic expressions
	result, _, err := parseExpression(expr, 0)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%g", result), nil
}

func parseExpression(expr string, pos int) (float64, int, error) {
	left, pos, err := parseTerm(expr, pos)
	if err != nil {
		return 0, pos, err
	}

	for pos < len(expr) && (expr[pos] == '+' || expr[pos] == '-') {
		op := expr[pos]
		pos++
		right, pos, err := parseTerm(expr, pos)
		if err != nil {
			return 0, pos, err
		}
		if op == '+' {
			left = left + right
		} else {
			left = left - right
		}
	}

	return left, pos, nil
}

func parseTerm(expr string, pos int) (float64, int, error) {
	left, pos, err := parseFactor(expr, pos)
	if err != nil {
		return 0, pos, err
	}

	for pos < len(expr) && (expr[pos] == '*' || expr[pos] == '/') {
		op := expr[pos]
		pos++
		right, pos, err := parseFactor(expr, pos)
		if err != nil {
			return 0, pos, err
		}
		if op == '*' {
			left = left * right
		} else {
			if right == 0 {
				return 0, pos, fmt.Errorf("division by zero")
			}
			left = left / right
		}
	}

	return left, pos, nil
}

func parseFactor(expr string, pos int) (float64, int, error) {
	if pos >= len(expr) {
		return 0, pos, fmt.Errorf("unexpected end of expression")
	}

	// Handle parentheses
	if expr[pos] == '(' {
		pos++
		result, pos, err := parseExpression(expr, pos)
		if err != nil {
			return 0, pos, err
		}
		if pos >= len(expr) || expr[pos] != ')' {
			return 0, pos, fmt.Errorf("missing closing parenthesis")
		}
		pos++
		return result, pos, nil
	}

	// Handle unary minus
	if expr[pos] == '-' {
		pos++
		result, pos, err := parseFactor(expr, pos)
		if err != nil {
			return 0, pos, err
		}
		return -result, pos, nil
	}

	// Handle unary plus
	if expr[pos] == '+' {
		pos++
		return parseFactor(expr, pos)
	}

	// Parse number
	start := pos
	for pos < len(expr) && ((expr[pos] >= '0' && expr[pos] <= '9') || expr[pos] == '.') {
		pos++
	}

	if start == pos {
		return 0, pos, fmt.Errorf("expected number")
	}

	num, err := strconv.ParseFloat(expr[start:pos], 64)
	if err != nil {
		return 0, pos, fmt.Errorf("invalid number")
	}

	return num, pos, nil
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req struct {
			Expression string `json:"expression"`
		}

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		if req.Expression == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Expression cannot be empty",
			})
		}

		result, err := evaluateExpression(req.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"result": result,
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}