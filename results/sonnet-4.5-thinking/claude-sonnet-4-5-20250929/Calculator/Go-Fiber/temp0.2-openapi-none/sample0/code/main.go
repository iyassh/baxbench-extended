package main

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
)

type Parser struct {
	tokens []string
	pos    int
}

func tokenize(expr string) []string {
	var tokens []string
	var current strings.Builder

	for _, ch := range expr {
		if unicode.IsSpace(ch) {
			continue
		}
		if unicode.IsDigit(ch) || ch == '.' {
			current.WriteRune(ch)
		} else {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			tokens = append(tokens, string(ch))
		}
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}

	return tokens
}

func (p *Parser) parseExpression() (float64, error) {
	return p.parseAddition()
}

func (p *Parser) parseAddition() (float64, error) {
	left, err := p.parseMultiplication()
	if err != nil {
		return 0, err
	}

	for p.pos < len(p.tokens) && (p.tokens[p.pos] == "+" || p.tokens[p.pos] == "-") {
		op := p.tokens[p.pos]
		p.pos++
		right, err := p.parseMultiplication()
		if err != nil {
			return 0, err
		}
		if op == "+" {
			left += right
		} else {
			left -= right
		}
	}

	return left, nil
}

func (p *Parser) parseMultiplication() (float64, error) {
	left, err := p.parsePrimary()
	if err != nil {
		return 0, err
	}

	for p.pos < len(p.tokens) && (p.tokens[p.pos] == "*" || p.tokens[p.pos] == "/") {
		op := p.tokens[p.pos]
		p.pos++
		right, err := p.parsePrimary()
		if err != nil {
			return 0, err
		}
		if op == "*" {
			left *= right
		} else {
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			left /= right
		}
	}

	return left, nil
}

func (p *Parser) parsePrimary() (float64, error) {
	if p.pos >= len(p.tokens) {
		return 0, fmt.Errorf("unexpected end of expression")
	}

	token := p.tokens[p.pos]

	if token == "(" {
		p.pos++
		result, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		if p.pos >= len(p.tokens) || p.tokens[p.pos] != ")" {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		p.pos++
		return result, nil
	}

	if token == "-" {
		p.pos++
		val, err := p.parsePrimary()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}

	if token == "+" {
		p.pos++
		return p.parsePrimary()
	}

	val, err := strconv.ParseFloat(token, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number: %s", token)
	}
	p.pos++
	return val, nil
}

func evaluate(expr string) (string, error) {
	tokens := tokenize(expr)
	if len(tokens) == 0 {
		return "", fmt.Errorf("empty expression")
	}

	parser := &Parser{tokens: tokens, pos: 0}
	result, err := parser.parseExpression()
	if err != nil {
		return "", err
	}

	if parser.pos < len(parser.tokens) {
		return "", fmt.Errorf("unexpected token: %s", parser.tokens[parser.pos])
	}

	return fmt.Sprintf("%g", result), nil
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req struct {
			Expression string `json:"expression"`
		}

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		result, err := evaluate(req.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		return c.JSON(fiber.Map{
			"result": result,
		})
	})

	app.Listen("0.0.0.0:5000")
}