package main

import (
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

type ErrorResponse struct {
	Error string `json:"error"`
}

type TokenType int

const (
	TokenNumber TokenType = iota
	TokenOperator
	TokenLeftParen
	TokenRightParen
)

type Token struct {
	Type  TokenType
	Value string
}

func tokenize(expr string) ([]Token, error) {
	var tokens []Token
	expr = strings.TrimSpace(expr)
	i := 0

	for i < len(expr) {
		ch := expr[i]

		if unicode.IsSpace(rune(ch)) {
			i++
			continue
		}

		if unicode.IsDigit(rune(ch)) || ch == '.' {
			start := i
			hasDecimal := ch == '.'
			i++
			for i < len(expr) {
				if unicode.IsDigit(rune(expr[i])) {
					i++
				} else if expr[i] == '.' && !hasDecimal {
					hasDecimal = true
					i++
				} else {
					break
				}
			}
			tokens = append(tokens, Token{Type: TokenNumber, Value: expr[start:i]})
			continue
		}

		if ch == '+' || ch == '-' || ch == '*' || ch == '/' {
			tokens = append(tokens, Token{Type: TokenOperator, Value: string(ch)})
			i++
			continue
		}

		if ch == '(' {
			tokens = append(tokens, Token{Type: TokenLeftParen, Value: "("})
			i++
			continue
		}

		if ch == ')' {
			tokens = append(tokens, Token{Type: TokenRightParen, Value: ")"})
			i++
			continue
		}

		return nil, fmt.Errorf("invalid character")
	}

	return tokens, nil
}

func precedence(op string) int {
	switch op {
	case "+", "-":
		return 1
	case "*", "/":
		return 2
	}
	return 0
}

func evaluateExpression(expr string) (float64, error) {
	if len(expr) > 1000 {
		return 0, fmt.Errorf("expression too long")
	}

	tokens, err := tokenize(expr)
	if err != nil {
		return 0, err
	}

	if len(tokens) == 0 {
		return 0, fmt.Errorf("empty expression")
	}

	if len(tokens) > 500 {
		return 0, fmt.Errorf("expression too complex")
	}

	var output []Token
	var operators []Token

	for _, token := range tokens {
		switch token.Type {
		case TokenNumber:
			output = append(output, token)

		case TokenOperator:
			for len(operators) > 0 {
				top := operators[len(operators)-1]
				if top.Type == TokenOperator && precedence(top.Value) >= precedence(token.Value) {
					output = append(output, top)
					operators = operators[:len(operators)-1]
				} else {
					break
				}
			}
			operators = append(operators, token)

		case TokenLeftParen:
			operators = append(operators, token)

		case TokenRightParen:
			found := false
			for len(operators) > 0 {
				top := operators[len(operators)-1]
				operators = operators[:len(operators)-1]
				if top.Type == TokenLeftParen {
					found = true
					break
				}
				output = append(output, top)
			}
			if !found {
				return 0, fmt.Errorf("mismatched parentheses")
			}
		}
	}

	for len(operators) > 0 {
		top := operators[len(operators)-1]
		if top.Type == TokenLeftParen {
			return 0, fmt.Errorf("mismatched parentheses")
		}
		output = append(output, top)
		operators = operators[:len(operators)-1]
	}

	var stack []float64

	for _, token := range output {
		if token.Type == TokenNumber {
			val, err := strconv.ParseFloat(token.Value, 64)
			if err != nil {
				return 0, fmt.Errorf("invalid number")
			}
			stack = append(stack, val)
		} else if token.Type == TokenOperator {
			if len(stack) < 2 {
				return 0, fmt.Errorf("invalid expression")
			}
			b := stack[len(stack)-1]
			a := stack[len(stack)-2]
			stack = stack[:len(stack)-2]

			var result float64
			switch token.Value {
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
			}
			stack = append(stack, result)
		}
	}

	if len(stack) != 1 {
		return 0, fmt.Errorf("invalid expression")
	}

	return stack[0], nil
}

func main() {
	app := fiber.New(fiber.Config{
		DisableStartupMessage: false,
		BodyLimit:             1 * 1024 * 1024,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{Error: "Internal server error"})
		},
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req CalculatorRequest

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request format"})
		}

		if strings.TrimSpace(req.Expression) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Expression cannot be empty"})
		}

		result, err := evaluateExpression(req.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid expression"})
		}

		resultStr := strconv.FormatFloat(result, 'f', -1, 64)

		return c.JSON(CalculatorResponse{Result: resultStr})
	})

	app.Listen("0.0.0.0:5000")
}