package main

import (
	"fmt"
	"log"
	"net"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Security middleware
	app.Use(recover.New())
	app.Use(securityHeadersMiddleware)

	app.Post("/calculator", handleCalculator)

	listener, err := net.Listen("tcp", "0.0.0.0:5000")
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	if err := app.Listener(listener); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func securityHeadersMiddleware(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError

	if fe, ok := err.(*fiber.Error); ok {
		code = fe.Code
	}

	// Don't expose internal error details
	if code == fiber.StatusInternalServerError {
		return c.Status(code).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(code).JSON(fiber.Map{
		"error": err.Error(),
	})
}

type CalculatorRequest struct {
	Expression string `json:"expression"`
}

type CalculatorResponse struct {
	Result string `json:"result"`
}

func handleCalculator(c *fiber.Ctx) error {
	var req CalculatorRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if req.Expression == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Validate expression to prevent code injection
	if !isValidExpression(req.Expression) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	result, err := evaluateExpression(req.Expression)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	return c.Status(fiber.StatusOK).JSON(CalculatorResponse{
		Result: result,
	})
}

func isValidExpression(expr string) bool {
	// Only allow digits, operators, spaces, and parentheses
	pattern := `^[\d\s+\-*/()\.]+([\d\s+\-*/()\.])*$`
	matched, err := regexp.MatchString(pattern, expr)
	if err != nil {
		return false
	}

	if !matched {
		return false
	}

	// Limit expression length to prevent resource exhaustion
	if len(expr) > 1000 {
		return false
	}

	return true
}

func evaluateExpression(expr string) (string, error) {
	// Remove spaces
	expr = strings.ReplaceAll(expr, " ", "")

	// Simple recursive descent parser for arithmetic expressions
	parser := &expressionParser{
		input: expr,
		pos:   0,
	}

	result, err := parser.parseExpression()
	if err != nil {
		return "", err
	}

	if parser.pos != len(parser.input) {
		return "", fmt.Errorf("unexpected characters at end of expression")
	}

	return fmt.Sprintf("%g", result), nil
}

type expressionParser struct {
	input string
	pos   int
}

func (p *expressionParser) parseExpression() (float64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}

	for p.pos < len(p.input) && (p.input[p.pos] == '+' || p.input[p.pos] == '-') {
		op := p.input[p.pos]
		p.pos++

		right, err := p.parseTerm()
		if err != nil {
			return 0, err
		}

		if op == '+' {
			left = left + right
		} else {
			left = left - right
		}
	}

	return left, nil
}

func (p *expressionParser) parseTerm() (float64, error) {
	left, err := p.parseFactor()
	if err != nil {
		return 0, err
	}

	for p.pos < len(p.input) && (p.input[p.pos] == '*' || p.input[p.pos] == '/') {
		op := p.input[p.pos]
		p.pos++

		right, err := p.parseFactor()
		if err != nil {
			return 0, err
		}

		if op == '*' {
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

func (p *expressionParser) parseFactor() (float64, error) {
	if p.pos >= len(p.input) {
		return 0, fmt.Errorf("unexpected end of expression")
	}

	// Handle parentheses
	if p.input[p.pos] == '(' {
		p.pos++
		result, err := p.parseExpression()
		if err != nil {
			return 0, err
		}

		if p.pos >= len(p.input) || p.input[p.pos] != ')' {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		p.pos++
		return result, nil
	}

	// Handle unary minus
	if p.input[p.pos] == '-' {
		p.pos++
		result, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		return -result, nil
	}

	// Handle unary plus
	if p.input[p.pos] == '+' {
		p.pos++
		return p.parseFactor()
	}

	// Parse number
	return p.parseNumber()
}

func (p *expressionParser) parseNumber() (float64, error) {
	start := p.pos

	// Parse digits before decimal point
	for p.pos < len(p.input) && p.input[p.pos] >= '0' && p.input[p.pos] <= '9' {
		p.pos++
	}

	// Parse decimal point and digits after
	if p.pos < len(p.input) && p.input[p.pos] == '.' {
		p.pos++
		for p.pos < len(p.input) && p.input[p.pos] >= '0' && p.input[p.pos] <= '9' {
			p.pos++
		}
	}

	if start == p.pos {
		return 0, fmt.Errorf("expected number")
	}

	numStr := p.input[start:p.pos]
	num, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number: %s", numStr)
	}

	return num, nil
}