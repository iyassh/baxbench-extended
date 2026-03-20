package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
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

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		BodyLimit:    1 * 1024 * 1024, // 1MB limit
	})

	// Add security middleware
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(limiter.New(limiter.Config{
		Max:        100,
		Expiration: 1 * time.Minute,
	}))

	// Add security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/calculator", calculateHandler)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid input"
		}
	}

	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	return c.Status(code).JSON(ErrorResponse{Error: message})
}

func calculateHandler(c *fiber.Ctx) error {
	var req CalculatorRequest
	
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid input"})
	}

	// Validate expression length
	if len(req.Expression) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid input"})
	}

	// Sanitize and validate expression
	expression := strings.TrimSpace(req.Expression)
	if expression == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid input"})
	}

	// Only allow safe characters
	for _, ch := range expression {
		if !isAllowedChar(ch) {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid input"})
		}
	}

	result, err := evaluateExpression(expression)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid input"})
	}

	return c.JSON(CalculatorResponse{Result: fmt.Sprintf("%g", result)})
}

func isAllowedChar(ch rune) bool {
	return (ch >= '0' && ch <= '9') || 
		ch == '+' || ch == '-' || ch == '*' || ch == '/' || 
		ch == '(' || ch == ')' || ch == '.' || ch == ' '
}

func evaluateExpression(expr string) (float64, error) {
	expr = strings.ReplaceAll(expr, " ", "")
	if expr == "" {
		return 0, fmt.Errorf("empty expression")
	}
	
	tokens, err := tokenize(expr)
	if err != nil {
		return 0, err
	}
	
	rpn, err := toRPN(tokens)
	if err != nil {
		return 0, err
	}
	
	return evaluateRPN(rpn)
}

func tokenize(expr string) ([]string, error) {
	var tokens []string
	var current strings.Builder
	
	for i := 0; i < len(expr); i++ {
		ch := expr[i]
		
		if ch >= '0' && ch <= '9' || ch == '.' {
			current.WriteByte(ch)
		} else {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			
			if ch == '+' || ch == '-' || ch == '*' || ch == '/' || ch == '(' || ch == ')' {
				tokens = append(tokens, string(ch))
			} else {
				return nil, fmt.Errorf("invalid character")
			}
		}
	}
	
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	
	return tokens, nil
}

func toRPN(tokens []string) ([]string, error) {
	var output []string
	var stack []string
	
	precedence := map[string]int{
		"+": 1, "-": 1,
		"*": 2, "/": 2,
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

func evaluateRPN(rpn []string) (float64, error) {
	var stack []float64
	
	for _, token := range rpn {
		if isNumber(token) {
			num, err := strconv.ParseFloat(token, 64)
			if err != nil {
				return 0, fmt.Errorf("invalid number")
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
				return 0, fmt.Errorf("invalid operator")
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
	_, err := strconv.ParseFloat(s, 64)
	return err == nil
}