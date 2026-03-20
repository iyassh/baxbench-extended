package main

import (
	"fmt"
	"strconv"
	"strings"
	"text/scanner"
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
		return fmt.Sprintf("%d", int64(f))
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// Simple recursive descent parser for arithmetic expressions
// Supports +, -, *, / and parentheses

type Parser struct {
	tokens []string
	pos    int
}

func tokenize(expr string) ([]string, error) {
	var tokens []string
	var s scanner.Scanner
	s.Init(strings.NewReader(expr))
	s.Mode = scanner.ScanInts | scanner.ScanFloats
	s.IsIdentRune = func(ch rune, i int) bool { return false }

	for tok := s.Scan(); tok != scanner.EOF; tok = s.Scan() {
		text := s.TokenText()
		tokens = append(tokens, text)
	}

	// Manual tokenizer to handle cases better
	return manualTokenize(expr)
}

func manualTokenize(expr string) ([]string, error) {
	var tokens []string
	i := 0
	runes := []rune(expr)
	for i < len(runes) {
		ch := runes[i]
		if unicode.IsSpace(ch) {
			i++
			continue
		}
		if ch == '+' || ch == '-' || ch == '*' || ch == '/' || ch == '(' || ch == ')' {
			tokens = append(tokens, string(ch))
			i++
		} else if unicode.IsDigit(ch) || ch == '.' {
			j := i
			for j < len(runes) && (unicode.IsDigit(runes[j]) || runes[j] == '.') {
				j++
			}
			tokens = append(tokens, string(runes[i:j]))
			i = j
		} else {
			return nil, fmt.Errorf("unexpected character: %c", ch)
		}
	}
	return tokens, nil
}

func evaluate(expr string) (float64, error) {
	tokens, err := tokenize(expr)
	if err != nil {
		return 0, err
	}
	p := &Parser{tokens: tokens, pos: 0}
	result, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	if p.pos != len(p.tokens) {
		return 0, fmt.Errorf("unexpected token at position %d", p.pos)
	}
	return result, nil
}

func (p *Parser) peek() string {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return ""
}

func (p *Parser) consume() string {
	tok := p.tokens[p.pos]
	p.pos++
	return tok
}

// parseExpr handles + and -
func (p *Parser) parseExpr() (float64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}

	for p.peek() == "+" || p.peek() == "-" {
		op := p.consume()
		right, err := p.parseTerm()
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

// parseTerm handles * and /
func (p *Parser) parseTerm() (float64, error) {
	left, err := p.parseFactor()
	if err != nil {
		return 0, err
	}

	for p.peek() == "*" || p.peek() == "/" {
		op := p.consume()
		right, err := p.parseFactor()
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

// parseFactor handles unary minus, numbers, and parentheses
func (p *Parser) parseFactor() (float64, error) {
	tok := p.peek()
	if tok == "" {
		return 0, fmt.Errorf("unexpected end of expression")
	}

	if tok == "-" {
		p.consume()
		val, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}

	if tok == "+" {
		p.consume()
		return p.parseFactor()
	}

	if tok == "(" {
		p.consume()
		val, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		if p.peek() != ")" {
			return 0, fmt.Errorf("expected closing parenthesis")
		}
		p.consume()
		return val, nil
	}

	// Try to parse as number
	p.consume()
	num, err := strconv.ParseFloat(tok, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number: %s", tok)
	}
	return num, nil
}