package main

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
)

type CalcRequest struct {
	Expression string `json:"expression"`
}

type CalcResponse struct {
	Result string `json:"result"`
}

// Tokenizer and parser for arithmetic expressions
// Supports +, -, *, /, parentheses, and integer/float numbers

type tokenType int

const (
	tokenNumber tokenType = iota
	tokenPlus
	tokenMinus
	tokenMul
	tokenDiv
	tokenLParen
	tokenRParen
	tokenEOF
)

type token struct {
	typ tokenType
	val string
}

func tokenize(expr string) ([]token, error) {
	var tokens []token
	i := 0
	for i < len(expr) {
		ch := rune(expr[i])
		if unicode.IsSpace(ch) {
			i++
			continue
		}
		if ch == '+' {
			tokens = append(tokens, token{tokenPlus, "+"})
			i++
		} else if ch == '-' {
			tokens = append(tokens, token{tokenMinus, "-"})
			i++
		} else if ch == '*' {
			tokens = append(tokens, token{tokenMul, "*"})
			i++
		} else if ch == '/' {
			tokens = append(tokens, token{tokenDiv, "/"})
			i++
		} else if ch == '(' {
			tokens = append(tokens, token{tokenLParen, "("})
			i++
		} else if ch == ')' {
			tokens = append(tokens, token{tokenRParen, ")"})
			i++
		} else if unicode.IsDigit(ch) || ch == '.' {
			j := i
			dotCount := 0
			for j < len(expr) && (unicode.IsDigit(rune(expr[j])) || expr[j] == '.') {
				if expr[j] == '.' {
					dotCount++
				}
				j++
			}
			if dotCount > 1 {
				return nil, fmt.Errorf("invalid number")
			}
			tokens = append(tokens, token{tokenNumber, expr[i:j]})
			i = j
		} else {
			return nil, fmt.Errorf("unexpected character: %c", ch)
		}
	}
	tokens = append(tokens, token{tokenEOF, ""})
	return tokens, nil
}

type parser struct {
	tokens []token
	pos    int
}

func (p *parser) current() token {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return token{tokenEOF, ""}
}

func (p *parser) eat(typ tokenType) error {
	if p.current().typ != typ {
		return fmt.Errorf("unexpected token: %v", p.current())
	}
	p.pos++
	return nil
}

func (p *parser) parseExpression() (float64, error) {
	result, err := p.parseTerm()
	if err != nil {
		return 0, err
	}
	for p.current().typ == tokenPlus || p.current().typ == tokenMinus {
		op := p.current().typ
		p.pos++
		right, err := p.parseTerm()
		if err != nil {
			return 0, err
		}
		if op == tokenPlus {
			result += right
		} else {
			result -= right
		}
	}
	return result, nil
}

func (p *parser) parseTerm() (float64, error) {
	result, err := p.parseFactor()
	if err != nil {
		return 0, err
	}
	for p.current().typ == tokenMul || p.current().typ == tokenDiv {
		op := p.current().typ
		p.pos++
		right, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		if op == tokenMul {
			result *= right
		} else {
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			result /= right
		}
	}
	return result, nil
}

func (p *parser) parseFactor() (float64, error) {
	cur := p.current()

	// Handle unary plus/minus
	if cur.typ == tokenMinus {
		p.pos++
		val, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}
	if cur.typ == tokenPlus {
		p.pos++
		return p.parseFactor()
	}

	if cur.typ == tokenNumber {
		p.pos++
		val, err := strconv.ParseFloat(cur.val, 64)
		if err != nil {
			return 0, err
		}
		return val, nil
	}
	if cur.typ == tokenLParen {
		err := p.eat(tokenLParen)
		if err != nil {
			return 0, err
		}
		val, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		err = p.eat(tokenRParen)
		if err != nil {
			return 0, err
		}
		return val, nil
	}
	return 0, fmt.Errorf("unexpected token: %v", cur)
}

func evaluate(expr string) (string, error) {
	tokens, err := tokenize(expr)
	if err != nil {
		return "", err
	}
	p := &parser{tokens: tokens, pos: 0}
	result, err := p.parseExpression()
	if err != nil {
		return "", err
	}
	if p.current().typ != tokenEOF {
		return "", fmt.Errorf("unexpected token after expression: %v", p.current())
	}

	// Format result: if it's an integer value, show without decimal
	if result == float64(int64(result)) {
		return strconv.FormatInt(int64(result), 10), nil
	}
	s := strconv.FormatFloat(result, 'f', -1, 64)
	// Remove trailing zeros after decimal point
	if strings.Contains(s, ".") {
		s = strings.TrimRight(s, "0")
		s = strings.TrimRight(s, ".")
	}
	return s, nil
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req CalcRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		if req.Expression == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		result, err := evaluate(req.Expression)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		return c.JSON(CalcResponse{Result: result})
	})

	app.Listen("0.0.0.0:5000")
}