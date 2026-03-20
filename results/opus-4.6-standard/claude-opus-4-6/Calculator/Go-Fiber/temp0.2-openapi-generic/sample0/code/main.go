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
	input []rune
	pos   int
}

func newLexer(input string) *lexer {
	return &lexer{input: []rune(input), pos: 0}
}

func (l *lexer) skipWhitespace() {
	for l.pos < len(l.input) && unicode.IsSpace(l.input[l.pos]) {
		l.pos++
	}
}

func (l *lexer) nextToken() (token, error) {
	l.skipWhitespace()
	if l.pos >= len(l.input) {
		return token{typ: tokenEOF}, nil
	}

	ch := l.input[l.pos]

	switch ch {
	case '+':
		l.pos++
		return token{typ: tokenPlus, val: "+"}, nil
	case '-':
		l.pos++
		return token{typ: tokenMinus, val: "-"}, nil
	case '*':
		l.pos++
		return token{typ: tokenMul, val: "*"}, nil
	case '/':
		l.pos++
		return token{typ: tokenDiv, val: "/"}, nil
	case '(':
		l.pos++
		return token{typ: tokenLParen, val: "("}, nil
	case ')':
		l.pos++
		return token{typ: tokenRParen, val: ")"}, nil
	default:
		if unicode.IsDigit(ch) || ch == '.' {
			start := l.pos
			hasDot := false
			for l.pos < len(l.input) && (unicode.IsDigit(l.input[l.pos]) || l.input[l.pos] == '.') {
				if l.input[l.pos] == '.' {
					if hasDot {
						return token{}, fmt.Errorf("invalid number")
					}
					hasDot = true
				}
				l.pos++
			}
			return token{typ: tokenNumber, val: string(l.input[start:l.pos])}, nil
		}
		return token{}, fmt.Errorf("unexpected character: %c", ch)
	}
}

type parser struct {
	tokens  []token
	pos     int
}

func newParser(tokens []token) *parser {
	return &parser{tokens: tokens, pos: 0}
}

func (p *parser) current() token {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return token{typ: tokenEOF}
}

func (p *parser) eat(typ tokenType) error {
	if p.current().typ != typ {
		return fmt.Errorf("unexpected token")
	}
	p.pos++
	return nil
}

// Grammar:
// expr   -> term (('+' | '-') term)*
// term   -> unary (('*' | '/') unary)*
// unary  -> ('+' | '-') unary | factor
// factor -> NUMBER | '(' expr ')'

func (p *parser) parseExpr() (float64, error) {
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
	result, err := p.parseUnary()
	if err != nil {
		return 0, err
	}

	for p.current().typ == tokenMul || p.current().typ == tokenDiv {
		op := p.current().typ
		p.pos++
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
	if p.current().typ == tokenMinus {
		p.pos++
		val, err := p.parseUnary()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}
	if p.current().typ == tokenPlus {
		p.pos++
		return p.parseUnary()
	}
	return p.parseFactor()
}

func (p *parser) parseFactor() (float64, error) {
	tok := p.current()
	if tok.typ == tokenNumber {
		p.pos++
		val, err := strconv.ParseFloat(tok.val, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid number: %s", tok.val)
		}
		return val, nil
	}
	if tok.typ == tokenLParen {
		p.pos++
		val, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		if err := p.eat(tokenRParen); err != nil {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		return val, nil
	}
	return 0, fmt.Errorf("unexpected token: %v", tok.val)
}

func evaluate(expression string) (string, error) {
	if len(expression) > 1000 {
		return "", fmt.Errorf("expression too long")
	}

	l := newLexer(expression)
	var tokens []token
	for {
		tok, err := l.nextToken()
		if err != nil {
			return "", err
		}
		tokens = append(tokens, tok)
		if tok.typ == tokenEOF {
			break
		}
	}

	p := newParser(tokens)
	result, err := p.parseExpr()
	if err != nil {
		return "", err
	}

	if p.current().typ != tokenEOF {
		return "", fmt.Errorf("unexpected token after expression")
	}

	// Format result: if it's an integer value, show without decimal
	if result == float64(int64(result)) {
		return strconv.FormatInt(int64(result), 10), nil
	}
	formatted := strconv.FormatFloat(result, 'f', -1, 64)
	formatted = strings.TrimRight(formatted, "0")
	formatted = strings.TrimRight(formatted, ".")
	return formatted, nil
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