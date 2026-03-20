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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		if strings.TrimSpace(body.Expression) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		result, err := evaluate(body.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		// Format result: if it's a whole number, show without decimal
		var resultStr string
		if result == float64(int64(result)) {
			resultStr = strconv.FormatInt(int64(result), 10)
		} else {
			resultStr = strconv.FormatFloat(result, 'f', -1, 64)
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{"result": resultStr})
	})

	app.Listen("0.0.0.0:5000")
}

// Simple recursive descent parser for arithmetic expressions
// Supports +, -, *, / and parentheses

type Parser struct {
	tokens []token
	pos    int
}

type tokenType int

const (
	tokNumber tokenType = iota
	tokPlus
	tokMinus
	tokMul
	tokDiv
	tokLParen
	tokRParen
	tokEOF
)

type token struct {
	typ tokenType
	val float64
}

func tokenize(expr string) ([]token, error) {
	var tokens []token
	var s scanner.Scanner
	s.Init(strings.NewReader(expr))
	s.Mode = scanner.ScanInts | scanner.ScanFloats
	s.IsIdentRune = func(ch rune, i int) bool { return false }

	for {
		tok := s.Scan()
		if tok == scanner.EOF {
			break
		}
		text := s.TokenText()
		switch {
		case tok == scanner.Int || tok == scanner.Float:
			val, err := strconv.ParseFloat(text, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid number: %s", text)
			}
			tokens = append(tokens, token{typ: tokNumber, val: val})
		case text == "+":
			tokens = append(tokens, token{typ: tokPlus})
		case text == "-":
			tokens = append(tokens, token{typ: tokMinus})
		case text == "*":
			tokens = append(tokens, token{typ: tokMul})
		case text == "/":
			tokens = append(tokens, token{typ: tokDiv})
		case text == "(":
			tokens = append(tokens, token{typ: tokLParen})
		case text == ")":
			tokens = append(tokens, token{typ: tokRParen})
		default:
			// Check if it's whitespace or unknown
			for _, ch := range text {
				if !unicode.IsSpace(ch) {
					return nil, fmt.Errorf("unexpected character: %s", text)
				}
			}
		}
	}
	tokens = append(tokens, token{typ: tokEOF})
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
	if p.current().typ != tokEOF {
		return 0, fmt.Errorf("unexpected token")
	}
	return result, nil
}

func (p *Parser) current() token {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return token{typ: tokEOF}
}

func (p *Parser) consume() token {
	tok := p.current()
	p.pos++
	return tok
}

// parseExpr handles + and -
func (p *Parser) parseExpr() (float64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}

	for {
		cur := p.current()
		if cur.typ == tokPlus {
			p.consume()
			right, err := p.parseTerm()
			if err != nil {
				return 0, err
			}
			left += right
		} else if cur.typ == tokMinus {
			p.consume()
			right, err := p.parseTerm()
			if err != nil {
				return 0, err
			}
			left -= right
		} else {
			break
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

	for {
		cur := p.current()
		if cur.typ == tokMul {
			p.consume()
			right, err := p.parseFactor()
			if err != nil {
				return 0, err
			}
			left *= right
		} else if cur.typ == tokDiv {
			p.consume()
			right, err := p.parseFactor()
			if err != nil {
				return 0, err
			}
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			left /= right
		} else {
			break
		}
	}
	return left, nil
}

// parseFactor handles unary minus, numbers, and parentheses
func (p *Parser) parseFactor() (float64, error) {
	cur := p.current()

	if cur.typ == tokMinus {
		p.consume()
		val, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}

	if cur.typ == tokPlus {
		p.consume()
		val, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		return val, nil
	}

	if cur.typ == tokLParen {
		p.consume()
		val, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		if p.current().typ != tokRParen {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		p.consume()
		return val, nil
	}

	if cur.typ == tokNumber {
		p.consume()
		return cur.val, nil
	}

	return 0, fmt.Errorf("unexpected token")
}