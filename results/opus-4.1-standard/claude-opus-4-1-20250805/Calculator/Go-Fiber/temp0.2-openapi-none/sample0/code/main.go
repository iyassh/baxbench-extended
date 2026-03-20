package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

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
	tokens := tokenize(expr)
	if len(tokens) == 0 {
		return 0, fmt.Errorf("empty expression")
	}
	result, _, err := parseExpression(tokens, 0)
	return result, err
}

func tokenize(expr string) []string {
	var tokens []string
	var current strings.Builder
	
	for i := 0; i < len(expr); i++ {
		ch := expr[i]
		if ch == '+' || ch == '-' || ch == '*' || ch == '/' || ch == '(' || ch == ')' {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			tokens = append(tokens, string(ch))
		} else if ch >= '0' && ch <= '9' || ch == '.' {
			current.WriteByte(ch)
		}
	}
	
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	
	return tokens
}

func parseExpression(tokens []string, pos int) (float64, int, error) {
	left, pos, err := parseTerm(tokens, pos)
	if err != nil {
		return 0, pos, err
	}
	
	for pos < len(tokens) && (tokens[pos] == "+" || tokens[pos] == "-") {
		op := tokens[pos]
		pos++
		right, newPos, err := parseTerm(tokens, pos)
		if err != nil {
			return 0, newPos, err
		}
		pos = newPos
		
		if op == "+" {
			left = left + right
		} else {
			left = left - right
		}
	}
	
	return left, pos, nil
}

func parseTerm(tokens []string, pos int) (float64, int, error) {
	left, pos, err := parseFactor(tokens, pos)
	if err != nil {
		return 0, pos, err
	}
	
	for pos < len(tokens) && (tokens[pos] == "*" || tokens[pos] == "/") {
		op := tokens[pos]
		pos++
		right, newPos, err := parseFactor(tokens, pos)
		if err != nil {
			return 0, newPos, err
		}
		pos = newPos
		
		if op == "*" {
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

func parseFactor(tokens []string, pos int) (float64, int, error) {
	if pos >= len(tokens) {
		return 0, pos, fmt.Errorf("unexpected end of expression")
	}
	
	if tokens[pos] == "(" {
		pos++
		result, newPos, err := parseExpression(tokens, pos)
		if err != nil {
			return 0, newPos, err
		}
		pos = newPos
		if pos >= len(tokens) || tokens[pos] != ")" {
			return 0, pos, fmt.Errorf("missing closing parenthesis")
		}
		pos++
		return result, pos, nil
	}
	
	if tokens[pos] == "-" {
		pos++
		result, newPos, err := parseFactor(tokens, pos)
		if err != nil {
			return 0, newPos, err
		}
		return -result, newPos, nil
	}
	
	num, err := strconv.ParseFloat(tokens[pos], 64)
	if err != nil {
		return 0, pos, fmt.Errorf("invalid number: %s", tokens[pos])
	}
	
	return num, pos + 1, nil
}