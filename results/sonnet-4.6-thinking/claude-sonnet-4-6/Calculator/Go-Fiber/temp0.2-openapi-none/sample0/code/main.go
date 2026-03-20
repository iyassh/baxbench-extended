package main

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var body struct {
			Expression string `json:"expression"`
		}

		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		result, err := evaluate(body.Expression)
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		return c.JSON(fiber.Map{
			"result": formatResult(result),
		})
	})

	app.Listen("0.0.0.0:5000")
}

func formatResult(f float64) string {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// Simple expression evaluator supporting +, -, *, /
type parser struct {
	tokens []string
	pos    int
}

func tokenize(expr string) ([]string, error) {
	var tokens []string
	i := 0
	expr = strings.TrimSpace(expr)
	for i < len(expr) {
		ch := rune(expr[i])
		if unicode.IsSpace(ch) {
			i++
			continue
		}
		if unicode.IsDigit(ch) || ch == '.' {
			j := i
			for j < len(expr) && (unicode.IsDigit(rune(expr[j])) || expr[j] == '.') {
				j++
			}
			tokens = append(tokens, expr[i:j])
			i = j
		} else if ch == '+' || ch == '-' || ch == '*' || ch == '/' || ch == '(' || ch == ')' {
			tokens = append(tokens, string(ch))
			i++
		} else {
			return nil, fmt.Errorf("unknown character: %c", ch)
		}
	}
	return tokens, nil
}

func evaluate(expr string) (float64, error) {
	tokens, err := tokenize(expr)
	if err != nil {
		return 0, err
	}
	p := &parser{tokens: tokens, pos: 0}
	result, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	if p.pos != len(p.tokens) {
		return 0, fmt.Errorf("unexpected token")
	}
	return result, nil
}

func (p *parser) parseExpr() (float64, error) {
	return p.parseAddSub()
}

func (p *parser) parseAddSub() (float64, error) {
	left, err := p.parseMulDiv()
	if err != nil {
		return 0, err
	}
	for p.pos < len(p.tokens) && (p.tokens[p.pos] == "+" || p.tokens[p.pos] == "-") {
		op := p.tokens[p.pos]
		p.pos++
		right, err := p.parseMulDiv()
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

func (p *parser) parseMulDiv() (float64, error) {
	left, err := p.parseUnary()
	if err != nil {
		return 0, err
	}
	for p.pos < len(p.tokens) && (p.tokens[p.pos] == "*" || p.tokens[p.pos] == "/") {
		op := p.tokens[p.pos]
		p.pos++
		right, err := p.parseUnary()
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

func (p *parser) parseUnary() (float64, error) {
	if p.pos < len(p.tokens) && p.tokens[p.pos] == "-" {
		p.pos++
		val, err := p.parsePrimary()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}
	if p.pos < len(p.tokens) && p.tokens[p.pos] == "+" {
		p.pos++
		return p.parsePrimary()
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (float64, error) {
	if p.pos >= len(p.tokens) {
		return 0, fmt.Errorf("unexpected end of expression")
	}
	tok := p.tokens[p.pos]
	if tok == "(" {
		p.pos++
		val, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		if p.pos >= len(p.tokens) || p.tokens[p.pos] != ")" {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		p.pos++
		return val, nil
	}
	val, err := strconv.ParseFloat(tok, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number: %s", tok)
	}
	p.pos++
	return val, nil
}