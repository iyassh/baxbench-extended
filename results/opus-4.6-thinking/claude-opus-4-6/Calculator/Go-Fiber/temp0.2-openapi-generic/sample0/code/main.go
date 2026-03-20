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

// Tokenizer and parser for safe arithmetic expression evaluation
// Supports: +, -, *, /, parentheses, integers and floating point numbers

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

type lexer struct {
	input  string
	pos    int
	tokens []token
}

func newLexer(input string) *lexer {
	return &lexer{input: input, pos: 0}
}

func (l *lexer) tokenize() ([]token, error) {
	for l.pos < len(l.input) {
		ch := rune(l.input[l.pos])

		if unicode.IsSpace(ch) {
			l.pos++
			continue
		}

		if ch == '+' {
			l.tokens = append(l.tokens, token{typ: tokenPlus, val: "+"})
			l.pos++
		} else if ch == '-' {
			l.tokens = append(l.tokens, token{typ: tokenMinus, val: "-"})
			l.pos++
		} else if ch == '*' {
			l.tokens = append(l.tokens, token{typ: tokenMul, val: "*"})
			l.pos++
		} else if ch == '/' {
			l.tokens = append(l.tokens, token{typ: tokenDiv, val: "/"})
			l.pos++
		} else if ch == '(' {
			l.tokens = append(l.tokens, token{typ: tokenLParen, val: "("})
			l.pos++
		} else if ch == ')' {
			l.tokens = append(l.tokens, token{typ: tokenRParen, val: ")"})
			l.pos++
		} else if unicode.IsDigit(ch) || ch == '.' {
			start := l.pos
			dotCount := 0
			for l.pos < len(l.input) && (unicode.IsDigit(rune(l.input[l.pos])) || l.input[l.pos] == '.') {
				if l.input[l.pos] == '.' {
					dotCount++
					if dotCount > 1 {
						return nil, fmt.Errorf("invalid number")
					}
				}
				l.pos++
			}
			l.tokens = append(l.tokens, token{typ: tokenNumber, val: l.input[start:l.pos]})
		} else {
			return nil, fmt.Errorf("unexpected character: %c", ch)
		}
	}
	l.tokens = append(l.tokens, token{typ: tokenEOF, val: ""})
	return l.tokens, nil
}

type parser struct {
	tokens []token
	pos    int
}

func newParser(tokens []token) *parser {
	return &parser{tokens: tokens, pos: 0}
}

func (p *parser) peek() token {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return token{typ: tokenEOF}
}

func (p *parser) consume() token {
	t := p.peek()
	p.pos++
	return t
}

func (p *parser) parseExpression() (float64, error) {
	return p.parseAddSub()
}

func (p *parser) parseAddSub() (float64, error) {
	left, err := p.parseMulDiv()
	if err != nil {
		return 0, err
	}

	for p.peek().typ == tokenPlus || p.peek().typ == tokenMinus {
		op := p.consume()
		right, err := p.parseMulDiv()
		if err != nil {
			return 0, err
		}
		if op.typ == tokenPlus {
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

	for p.peek().typ == tokenMul || p.peek().typ == tokenDiv {
		op := p.consume()
		right, err := p.parseUnary()
		if err != nil {
			return 0, err
		}
		if op.typ == tokenMul {
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
	if p.peek().typ == tokenMinus {
		p.consume()
		val, err := p.parseUnary()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}
	if p.peek().typ == tokenPlus {
		p.consume()
		return p.parseUnary()
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (float64, error) {
	t := p.peek()

	if t.typ == tokenNumber {
		p.consume()
		val, err := strconv.ParseFloat(t.val, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid number: %s", t.val)
		}
		return val, nil
	}

	if t.typ == tokenLParen {
		p.consume()
		val, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		if p.peek().typ != tokenRParen {
			return 0, fmt.Errorf("expected closing parenthesis")
		}
		p.consume()
		return val, nil
	}

	return 0, fmt.Errorf("unexpected token: %s", t.val)
}

func evaluate(expression string) (string, error) {
	if len(expression) > 1000 {
		return "", fmt.Errorf("expression too long")
	}

	l := newLexer(expression)
	tokens, err := l.tokenize()
	if err != nil {
		return "", err
	}

	p := newParser(tokens)
	result, err := p.parseExpression()
	if err != nil {
		return "", err
	}

	if p.peek().typ != tokenEOF {
		return "", fmt.Errorf("unexpected token after expression")
	}

	// Format result: if it's an integer value, show without decimal
	if result == float64(int64(result)) {
		return strconv.FormatInt(int64(result), 10), nil
	}
	resultStr := strconv.FormatFloat(result, 'f', -1, 64)
	resultStr = strings.TrimRight(resultStr, "0")
	resultStr = strings.TrimRight(resultStr, ".")
	return resultStr, nil
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req CalculatorRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if strings.TrimSpace(req.Expression) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Expression is required"})
		}

		result, err := evaluate(req.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(CalculatorResponse{Result: result})
	})

	app.Listen("0.0.0.0:5000")
}