package main

import (
	"errors"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			var e *fiber.Error
			if errors.As(err, &e) {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/calculator", handleCalculator)

	app.Listen("0.0.0.0:5000")
}

func handleCalculator(c *fiber.Ctx) error {
	var body struct {
		Expression string `json:"expression"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	expr := strings.TrimSpace(body.Expression)
	if len(expr) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Limit expression length to prevent resource exhaustion (CWE-400)
	if len(expr) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	result, err := evaluate(expr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Format result: if it's an integer, show without decimal
	resultStr := formatResult(result)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"result": resultStr})
}

func formatResult(f float64) string {
	// Check if the result is an integer
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// Simple recursive descent parser for arithmetic expressions
// Supports: +, -, *, /, parentheses, integers and decimals

type parser struct {
	input []rune
	pos   int
}

func evaluate(expr string) (float64, error) {
	p := &parser{input: []rune(expr), pos: 0}
	result, err := p.parseExpression()
	if err != nil {
		return 0, err
	}
	p.skipWhitespace()
	if p.pos != len(p.input) {
		return 0, errors.New("unexpected characters")
	}
	return result, nil
}

func (p *parser) skipWhitespace() {
	for p.pos < len(p.input) && unicode.IsSpace(p.input[p.pos]) {
		p.pos++
	}
}

func (p *parser) parseExpression() (float64, error) {
	return p.parseAddSub()
}

func (p *parser) parseAddSub() (float64, error) {
	left, err := p.parseMulDiv()
	if err != nil {
		return 0, err
	}

	for {
		p.skipWhitespace()
		if p.pos >= len(p.input) {
			break
		}
		op := p.input[p.pos]
		if op != '+' && op != '-' {
			break
		}
		p.pos++
		right, err := p.parseMulDiv()
		if err != nil {
			return 0, err
		}
		if op == '+' {
			left += right
		} else {
			left -= right
		}
	}
	return left, nil
}

func (p *parser) parseMulDiv() (float64, error) {
	left, err := p.parseUnary()
	if err != nil {
		return 0, err
	}

	for {
		p.skipWhitespace()
		if p.pos >= len(p.input) {
			break
		}
		op := p.input[p.pos]
		if op != '*' && op != '/' {
			break
		}
		p.pos++
		right, err := p.parseUnary()
		if err != nil {
			return 0, err
		}
		if op == '*' {
			left *= right
		} else {
			if right == 0 {
				return 0, errors.New("division by zero")
			}
			left /= right
		}
	}
	return left, nil
}

func (p *parser) parseUnary() (float64, error) {
	p.skipWhitespace()
	if p.pos < len(p.input) && p.input[p.pos] == '-' {
		p.pos++
		val, err := p.parsePrimary()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}
	if p.pos < len(p.input) && p.input[p.pos] == '+' {
		p.pos++
		return p.parsePrimary()
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (float64, error) {
	p.skipWhitespace()
	if p.pos >= len(p.input) {
		return 0, errors.New("unexpected end of expression")
	}

	if p.input[p.pos] == '(' {
		p.pos++ // consume '('
		val, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		p.skipWhitespace()
		if p.pos >= len(p.input) || p.input[p.pos] != ')' {
			return 0, errors.New("missing closing parenthesis")
		}
		p.pos++ // consume ')'
		return val, nil
	}

	// Parse number
	return p.parseNumber()
}

func (p *parser) parseNumber() (float64, error) {
	p.skipWhitespace()
	start := p.pos
	if p.pos < len(p.input) && (p.input[p.pos] == '+' || p.input[p.pos] == '-') {
		p.pos++
	}
	hasDigits := false
	for p.pos < len(p.input) && unicode.IsDigit(p.input[p.pos]) {
		hasDigits = true
		p.pos++
	}
	if p.pos < len(p.input) && p.input[p.pos] == '.' {
		p.pos++
		for p.pos < len(p.input) && unicode.IsDigit(p.input[p.pos]) {
			hasDigits = true
			p.pos++
		}
	}
	if !hasDigits {
		return 0, errors.New("expected number")
	}
	numStr := string(p.input[start:p.pos])
	val, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return 0, errors.New("invalid number")
	}
	return val, nil
}