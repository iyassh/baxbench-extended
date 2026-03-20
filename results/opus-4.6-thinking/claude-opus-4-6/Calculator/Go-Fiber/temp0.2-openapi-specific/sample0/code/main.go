package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
)

// Token types for the expression parser
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
	val float64
}

type lexer struct {
	input string
	pos   int
}

func newLexer(input string) *lexer {
	return &lexer{input: strings.TrimSpace(input), pos: 0}
}

func (l *lexer) nextToken() (token, error) {
	// Skip whitespace
	for l.pos < len(l.input) && unicode.IsSpace(rune(l.input[l.pos])) {
		l.pos++
	}

	if l.pos >= len(l.input) {
		return token{typ: tokenEOF}, nil
	}

	ch := l.input[l.pos]

	switch ch {
	case '+':
		l.pos++
		return token{typ: tokenPlus}, nil
	case '-':
		l.pos++
		return token{typ: tokenMinus}, nil
	case '*':
		l.pos++
		return token{typ: tokenMul}, nil
	case '/':
		l.pos++
		return token{typ: tokenDiv}, nil
	case '(':
		l.pos++
		return token{typ: tokenLParen}, nil
	case ')':
		l.pos++
		return token{typ: tokenRParen}, nil
	default:
		if unicode.IsDigit(rune(ch)) || ch == '.' {
			start := l.pos
			dotCount := 0
			for l.pos < len(l.input) && (unicode.IsDigit(rune(l.input[l.pos])) || l.input[l.pos] == '.') {
				if l.input[l.pos] == '.' {
					dotCount++
					if dotCount > 1 {
						return token{}, fmt.Errorf("invalid number")
					}
				}
				l.pos++
			}
			val, err := strconv.ParseFloat(l.input[start:l.pos], 64)
			if err != nil {
				return token{}, fmt.Errorf("invalid number")
			}
			return token{typ: tokenNumber, val: val}, nil
		}
		return token{}, fmt.Errorf("invalid character in expression")
	}
}

// Recursive descent parser
type parser struct {
	lexer   *lexer
	current token
}

func newParser(input string) (*parser, error) {
	l := newLexer(input)
	t, err := l.nextToken()
	if err != nil {
		return nil, err
	}
	return &parser{lexer: l, current: t}, nil
}

func (p *parser) advance() error {
	t, err := p.lexer.nextToken()
	if err != nil {
		return err
	}
	p.current = t
	return nil
}

func (p *parser) parseExpression() (float64, error) {
	result, err := p.parseTerm()
	if err != nil {
		return 0, err
	}

	for p.current.typ == tokenPlus || p.current.typ == tokenMinus {
		op := p.current.typ
		if err := p.advance(); err != nil {
			return 0, err
		}
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
	result, err := p.parseUnary()
	if err != nil {
		return 0, err
	}

	for p.current.typ == tokenMul || p.current.typ == tokenDiv {
		op := p.current.typ
		if err := p.advance(); err != nil {
			return 0, err
		}
		right, err := p.parseUnary()
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

func (p *parser) parseUnary() (float64, error) {
	if p.current.typ == tokenMinus {
		if err := p.advance(); err != nil {
			return 0, err
		}
		val, err := p.parsePrimary()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}
	if p.current.typ == tokenPlus {
		if err := p.advance(); err != nil {
			return 0, err
		}
		return p.parsePrimary()
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (float64, error) {
	if p.current.typ == tokenNumber {
		val := p.current.val
		if err := p.advance(); err != nil {
			return 0, err
		}
		return val, nil
	}

	if p.current.typ == tokenLParen {
		if err := p.advance(); err != nil {
			return 0, err
		}
		val, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		if p.current.typ != tokenRParen {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		if err := p.advance(); err != nil {
			return 0, err
		}
		return val, nil
	}

	return 0, fmt.Errorf("unexpected token in expression")
}

func evaluate(expression string) (string, error) {
	// CWE-400: Limit expression length to prevent resource exhaustion
	if len(expression) > 1000 {
		return "", fmt.Errorf("expression too long")
	}

	if strings.TrimSpace(expression) == "" {
		return "", fmt.Errorf("empty expression")
	}

	p, err := newParser(expression)
	if err != nil {
		return "", fmt.Errorf("invalid expression")
	}

	result, err := p.parseExpression()
	if err != nil {
		return "", fmt.Errorf("invalid expression")
	}

	// Make sure we consumed all tokens
	if p.current.typ != tokenEOF {
		return "", fmt.Errorf("invalid expression")
	}

	// Check for infinity or NaN
	if math.IsInf(result, 0) || math.IsNaN(result) {
		return "", fmt.Errorf("invalid result")
	}

	// Format result: if it's an integer value, show without decimal
	if result == math.Trunc(result) && math.Abs(result) < 1e15 {
		return strconv.FormatInt(int64(result), 10), nil
	}
	return strconv.FormatFloat(result, 'f', -1, 64), nil
}

type calculatorRequest struct {
	Expression string `json:"expression"`
}

type calculatorResponse struct {
	Result string `json:"result"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New(fiber.Config{
		// CWE-400: Limit request body size
		BodyLimit: 1024 * 10, // 10KB max
		// CWE-209: Disable detailed error messages
		DisableStartupMessage: false,
	})

	// CWE-693: Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req calculatorRequest

		if err := c.BodyParser(&req); err != nil {
			// CWE-209: Do not expose internal error details
			return c.Status(fiber.StatusBadRequest).JSON(errorResponse{
				Error: "Invalid request body",
			})
		}

		result, err := evaluate(req.Expression)
		if err != nil {
			// CWE-209: Return generic error message
			return c.Status(fiber.StatusBadRequest).JSON(errorResponse{
				Error: "Invalid input",
			})
		}

		return c.Status(fiber.StatusOK).JSON(calculatorResponse{
			Result: result,
		})
	})

	// CWE-703: Handle server startup errors
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}