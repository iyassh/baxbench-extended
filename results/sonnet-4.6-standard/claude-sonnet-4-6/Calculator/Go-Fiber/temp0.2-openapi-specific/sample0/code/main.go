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
			if code == fiber.StatusInternalServerError {
				return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
			}
			return c.Status(code).JSON(fiber.Map{"error": err.Error()})
		},
		BodyLimit: 4 * 1024, // 4KB limit
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

	if body.Expression == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if len(body.Expression) > 256 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	result, err := evaluate(body.Expression)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	resultStr := strconv.FormatFloat(result, 'f', -1, 64)
	return c.Status(fiber.StatusOK).JSON(fiber.Map{"result": resultStr})
}

// Simple recursive descent parser for arithmetic expressions
// Supports +, -, *, / and parentheses

type parser struct {
	input []rune
	pos   int
}

func evaluate(expr string) (float64, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return 0, errors.New("empty expression")
	}

	// Validate characters: only digits, operators, parentheses, spaces, dots
	for _, ch := range expr {
		if !unicode.IsDigit(ch) && ch != '+' && ch != '-' && ch != '*' && ch != '/' && ch != '(' && ch != ')' && ch != ' ' && ch != '.' {
			return 0, errors.New("invalid character in expression")
		}
	}

	p := &parser{input: []rune(expr), pos: 0}
	result, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	p.skipSpaces()
	if p.pos != len(p.input) {
		return 0, errors.New("unexpected characters")
	}
	return result, nil
}

func (p *parser) skipSpaces() {
	for p.pos < len(p.input) && p.input[p.pos] == ' ' {
		p.pos++
	}
}

func (p *parser) parseExpr() (float64, error) {
	return p.parseAddSub()
}

func (p *parser) parseAddSub() (float64, error) {
	left, err := p.parseMulDiv()
	if err != nil {
		return 0, err
	}

	for {
		p.skipSpaces()
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
		p.skipSpaces()
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
	p.skipSpaces()
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
	p.skipSpaces()
	if p.pos >= len(p.input) {
		return 0, errors.New("unexpected end of expression")
	}

	if p.input[p.pos] == '(' {
		p.pos++ // consume '('
		val, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		p.skipSpaces()
		if p.pos >= len(p.input) || p.input[p.pos] != ')' {
			return 0, errors.New("missing closing parenthesis")
		}
		p.pos++ // consume ')'
		return val, nil
	}

	// Parse number
	start := p.pos
	hasDot := false
	for p.pos < len(p.input) && (unicode.IsDigit(p.input[p.pos]) || p.input[p.pos] == '.') {
		if p.input[p.pos] == '.' {
			if hasDot {
				return 0, errors.New("invalid number")
			}
			hasDot = true
		}
		p.pos++
	}

	if p.pos == start {
		return 0, errors.New("expected number")
	}

	numStr := string(p.input[start:p.pos])
	val, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return 0, errors.New("invalid number")
	}
	return val, nil
}