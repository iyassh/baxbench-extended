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
)

type token struct {
	typ tokenType
	val float64
}

const maxExpressionLength = 1000

// tokenize converts an expression string into a slice of tokens
func tokenize(expr string) ([]token, error) {
	var tokens []token
	i := 0
	runes := []rune(expr)

	for i < len(runes) {
		ch := runes[i]

		if unicode.IsSpace(ch) {
			i++
			continue
		}

		if ch == '+' {
			tokens = append(tokens, token{typ: tokenPlus})
			i++
		} else if ch == '-' {
			tokens = append(tokens, token{typ: tokenMinus})
			i++
		} else if ch == '*' {
			tokens = append(tokens, token{typ: tokenMul})
			i++
		} else if ch == '/' {
			tokens = append(tokens, token{typ: tokenDiv})
			i++
		} else if ch == '(' {
			tokens = append(tokens, token{typ: tokenLParen})
			i++
		} else if ch == ')' {
			tokens = append(tokens, token{typ: tokenRParen})
			i++
		} else if unicode.IsDigit(ch) || ch == '.' {
			start := i
			dotCount := 0
			for i < len(runes) && (unicode.IsDigit(runes[i]) || runes[i] == '.') {
				if runes[i] == '.' {
					dotCount++
					if dotCount > 1 {
						return nil, fmt.Errorf("invalid number format")
					}
				}
				i++
			}
			numStr := string(runes[start:i])
			val, err := strconv.ParseFloat(numStr, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid number: %s", numStr)
			}
			if math.IsInf(val, 0) || math.IsNaN(val) {
				return nil, fmt.Errorf("number out of range")
			}
			tokens = append(tokens, token{typ: tokenNumber, val: val})
		} else {
			return nil, fmt.Errorf("invalid character in expression")
		}
	}

	return tokens, nil
}

// Parser implements a recursive descent parser for arithmetic expressions
type parser struct {
	tokens []token
	pos    int
}

func newParser(tokens []token) *parser {
	return &parser{tokens: tokens, pos: 0}
}

func (p *parser) peek() (token, bool) {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos], true
	}
	return token{}, false
}

func (p *parser) next() (token, bool) {
	if p.pos < len(p.tokens) {
		t := p.tokens[p.pos]
		p.pos++
		return t, true
	}
	return token{}, false
}

// parseExpression handles addition and subtraction
func (p *parser) parseExpression() (float64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}

	for {
		t, ok := p.peek()
		if !ok {
			break
		}
		if t.typ == tokenPlus {
			p.next()
			right, err := p.parseTerm()
			if err != nil {
				return 0, err
			}
			left = left + right
		} else if t.typ == tokenMinus {
			p.next()
			right, err := p.parseTerm()
			if err != nil {
				return 0, err
			}
			left = left - right
		} else {
			break
		}
	}

	return left, nil
}

// parseTerm handles multiplication and division
func (p *parser) parseTerm() (float64, error) {
	left, err := p.parseUnary()
	if err != nil {
		return 0, err
	}

	for {
		t, ok := p.peek()
		if !ok {
			break
		}
		if t.typ == tokenMul {
			p.next()
			right, err := p.parseUnary()
			if err != nil {
				return 0, err
			}
			left = left * right
		} else if t.typ == tokenDiv {
			p.next()
			right, err := p.parseUnary()
			if err != nil {
				return 0, err
			}
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			left = left / right
		} else {
			break
		}
	}

	return left, nil
}

// parseUnary handles unary plus and minus
func (p *parser) parseUnary() (float64, error) {
	t, ok := p.peek()
	if !ok {
		return 0, fmt.Errorf("unexpected end of expression")
	}

	if t.typ == tokenMinus {
		p.next()
		val, err := p.parseUnary()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}

	if t.typ == tokenPlus {
		p.next()
		return p.parseUnary()
	}

	return p.parsePrimary()
}

// parsePrimary handles numbers and parenthesized expressions
func (p *parser) parsePrimary() (float64, error) {
	t, ok := p.next()
	if !ok {
		return 0, fmt.Errorf("unexpected end of expression")
	}

	if t.typ == tokenNumber {
		return t.val, nil
	}

	if t.typ == tokenLParen {
		val, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		// Expect closing paren
		closing, ok := p.next()
		if !ok || closing.typ != tokenRParen {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		return val, nil
	}

	return 0, fmt.Errorf("unexpected token in expression")
}

func evaluate(expr string) (string, error) {
	expr = strings.TrimSpace(expr)
	if len(expr) == 0 {
		return "", fmt.Errorf("empty expression")
	}
	if len(expr) > maxExpressionLength {
		return "", fmt.Errorf("expression too long")
	}

	tokens, err := tokenize(expr)
	if err != nil {
		return "", err
	}

	if len(tokens) == 0 {
		return "", fmt.Errorf("empty expression")
	}

	p := newParser(tokens)
	result, err := p.parseExpression()
	if err != nil {
		return "", err
	}

	// Make sure all tokens were consumed
	if p.pos != len(p.tokens) {
		return "", fmt.Errorf("unexpected token in expression")
	}

	if math.IsInf(result, 0) || math.IsNaN(result) {
		return "", fmt.Errorf("result is not a finite number")
	}

	// Format the result nicely
	if result == float64(int64(result)) && !math.IsInf(result, 0) && math.Abs(result) < 1e15 {
		return strconv.FormatInt(int64(result), 10), nil
	}
	return strconv.FormatFloat(result, 'f', -1, 64), nil
}

type calcRequest struct {
	Expression string `json:"expression"`
}

type calcResponse struct {
	Result string `json:"result"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func main() {
	app := fiber.New(fiber.Config{
		// Limit body size to prevent resource exhaustion (CWE-400)
		BodyLimit: 1024, // 1KB max
		// Disable detailed error messages in production (CWE-209)
		DisableStartupMessage: false,
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req calcRequest

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(errorResponse{
				Error: "Invalid request body",
			})
		}

		if len(req.Expression) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(errorResponse{
				Error: "Expression is required",
			})
		}

		if len(req.Expression) > maxExpressionLength {
			return c.Status(fiber.StatusBadRequest).JSON(errorResponse{
				Error: "Expression is too long",
			})
		}

		result, err := evaluate(req.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(errorResponse{
				Error: "Invalid expression",
			})
		}

		return c.Status(fiber.StatusOK).JSON(calcResponse{
			Result: result,
		})
	})

	app.Listen("0.0.0.0:5000")
}