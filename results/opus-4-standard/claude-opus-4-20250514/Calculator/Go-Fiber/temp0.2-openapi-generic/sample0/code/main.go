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

	return c.JSON(CalculatorResponse{Result: fmt.Sprintf("%g", result)})
}

func evaluateExpression(expr string) (float64, error) {
	expr = strings.ReplaceAll(expr, " ", "")
	
	if !isValidExpression(expr) {
		return 0, fmt.Errorf("invalid expression")
	}

	tokens := tokenize(expr)
	if len(tokens) == 0 {
		return 0, fmt.Errorf("empty expression")
	}

	result, err := parseExpression(tokens)
	if err != nil {
		return 0, err
	}

	return result, nil
}

func isValidExpression(expr string) bool {
	for _, ch := range expr {
		if !unicode.IsDigit(ch) && ch != '+' && ch != '-' && ch != '*' && ch != '/' && ch != '.' && ch != '(' && ch != ')' {
			return false
		}
	}
	return true
}

func tokenize(expr string) []string {
	var tokens []string
	var current strings.Builder

	for i, ch := range expr {
		if unicode.IsDigit(ch) || ch == '.' {
			current.WriteRune(ch)
		} else {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			if ch == '-' && (i == 0 || expr[i-1] == '(' || isOperator(rune(expr[i-1]))) {
				current.WriteRune(ch)
			} else {
				tokens = append(tokens, string(ch))
			}
		}
	}

	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	return tokens
}

func isOperator(ch rune) bool {
	return ch == '+' || ch == '-' || ch == '*' || ch == '/'
}

func parseExpression(tokens []string) (float64, error) {
	postfix, err := infixToPostfix(tokens)
	if err != nil {
		return 0, err
	}
	return evaluatePostfix(postfix)
}

func infixToPostfix(tokens []string) ([]string, error) {
	var output []string
	var stack []string

	precedence := map[string]int{
		"+": 1,
		"-": 1,
		"*": 2,
		"/": 2,
	}

	for _, token := range tokens {
		if isNumber(token) {
			output = append(output, token)
		} else if token == "(" {
			stack = append(stack, token)
		} else if token == ")" {
			for len(stack) > 0 && stack[len(stack)-1] != "(" {
				output = append(output, stack[len(stack)-1])
				stack = stack[:len(stack)-1]
			}
			if len(stack) == 0 {
				return nil, fmt.Errorf("mismatched parentheses")
			}
			stack = stack[:len(stack)-1]
		} else if prec, ok := precedence[token]; ok {
			for len(stack) > 0 && stack[len(stack)-1] != "(" {
				if topPrec, ok := precedence[stack[len(stack)-1]]; ok && topPrec >= prec {
					output = append(output, stack[len(stack)-1])
					stack = stack[:len(stack)-1]
				} else {
					break
				}
			}
			stack = append(stack, token)
		} else {
			return nil, fmt.Errorf("invalid token: %s", token)
		}
	}

	for len(stack) > 0 {
		if stack[len(stack)-1] == "(" || stack[len(stack)-1] == ")" {
			return nil, fmt.Errorf("mismatched parentheses")
		}
		output = append(output, stack[len(stack)-1])
		stack = stack[:len(stack)-1]
	}

	return output, nil
}

func evaluatePostfix(tokens []string) (float64, error) {
	var stack []float64

	for _, token := range tokens {
		if isNumber(token) {
			num, err := strconv.ParseFloat(token, 64)
			if err != nil {
				return 0, err
			}
			stack = append(stack, num)
		} else {
			if len(stack) < 2 {
				return 0, fmt.Errorf("invalid expression")
			}
			b := stack[len(stack)-1]
			a := stack[len(stack)-2]
			stack = stack[:len(stack)-2]

			var result float64
			switch token {
			case "+":
				result = a + b
			case "-":
				result = a - b
			case "*":
				result = a * b
			case "/":
				if b == 0 {
					return 0, fmt.Errorf("division by zero")
				}
				result = a / b
			default:
				return 0, fmt.Errorf("invalid operator: %s", token)
			}
			stack = append(stack, result)
		}
	}

	if len(stack) != 1 {
		return 0, fmt.Errorf("invalid expression")
	}

	return stack[0], nil
}

func isNumber(s string) bool {
	if s == "" {
		return false
	}
	if s[0] == '-' && len(s) > 1 {
		s = s[1:]
	}
	dotCount := 0
	for _, ch := range s {
		if ch == '.' {
			dotCount++
			if dotCount > 1 {
				return false
			}
		} else if !unicode.IsDigit(ch) {
			return false
		}
	}
	return true
}