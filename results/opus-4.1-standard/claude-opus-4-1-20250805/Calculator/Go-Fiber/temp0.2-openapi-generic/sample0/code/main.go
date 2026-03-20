package main

import (
	"encoding/json"
	"fmt"
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

	app.Post("/calculator", calculateHandler)

	app.Listen("0.0.0.0:5000")
}

func calculateHandler(c *fiber.Ctx) error {
	var req CalculatorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Expression == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	result, err := evaluateExpression(req.Expression)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.JSON(CalculatorResponse{
		Result: fmt.Sprintf("%g", result),
	})
}

func evaluateExpression(expr string) (float64, error) {
	expr = strings.ReplaceAll(expr, " ", "")
	
	if expr == "" {
		return 0, fmt.Errorf("empty expression")
	}

	for _, ch := range expr {
		if !unicode.IsDigit(ch) && ch != '+' && ch != '-' && ch != '*' && ch != '/' && ch != '.' && ch != '(' && ch != ')' {
			return 0, fmt.Errorf("invalid character")
		}
	}

	tokens := tokenize(expr)
	if len(tokens) == 0 {
		return 0, fmt.Errorf("invalid expression")
	}

	result, err := parseExpression(tokens)
	if err != nil {
		return 0, err
	}

	return result, nil
}

func tokenize(expr string) []string {
	var tokens []string
	var current strings.Builder

	for i := 0; i < len(expr); i++ {
		ch := expr[i]
		if unicode.IsDigit(rune(ch)) || ch == '.' {
			current.WriteByte(ch)
		} else {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			if ch == '+' || ch == '-' || ch == '*' || ch == '/' || ch == '(' || ch == ')' {
				tokens = append(tokens, string(ch))
			}
		}
	}

	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	return tokens
}

func parseExpression(tokens []string) (float64, error) {
	if len(tokens) == 0 {
		return 0, fmt.Errorf("empty expression")
	}

	pos := 0
	result, err := parseAddSub(tokens, &pos)
	if err != nil {
		return 0, err
	}

	if pos < len(tokens) {
		return 0, fmt.Errorf("unexpected token")
	}

	return result, nil
}

func parseAddSub(tokens []string, pos *int) (float64, error) {
	left, err := parseMulDiv(tokens, pos)
	if err != nil {
		return 0, err
	}

	for *pos < len(tokens) && (tokens[*pos] == "+" || tokens[*pos] == "-") {
		op := tokens[*pos]
		*pos++
		right, err := parseMulDiv(tokens, pos)
		if err != nil {
			return 0, err
		}
		if op == "+" {
			left = left + right
		} else {
			left = left - right
		}
	}

	return left, nil
}

func parseMulDiv(tokens []string, pos *int) (float64, error) {
	left, err := parseFactor(tokens, pos)
	if err != nil {
		return 0, err
	}

	for *pos < len(tokens) && (tokens[*pos] == "*" || tokens[*pos] == "/") {
		op := tokens[*pos]
		*pos++
		right, err := parseFactor(tokens, pos)
		if err != nil {
			return 0, err
		}
		if op == "*" {
			left = left * right
		} else {
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			left = left / right
		}
	}

	return left, nil
}

func parseFactor(tokens []string, pos *int) (float64, error) {
	if *pos >= len(tokens) {
		return 0, fmt.Errorf("unexpected end of expression")
	}

	token := tokens[*pos]

	if token == "(" {
		*pos++
		result, err := parseAddSub(tokens, pos)
		if err != nil {
			return 0, err
		}
		if *pos >= len(tokens) || tokens[*pos] != ")" {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		*pos++
		return result, nil
	}

	if token == "-" {
		*pos++
		value, err := parseFactor(tokens, pos)
		if err != nil {
			return 0, err
		}
		return -value, nil
	}

	if token == "+" {
		*pos++
		return parseFactor(tokens, pos)
	}

	value, err := strconv.ParseFloat(token, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number")
	}
	*pos++
	return value, nil
}