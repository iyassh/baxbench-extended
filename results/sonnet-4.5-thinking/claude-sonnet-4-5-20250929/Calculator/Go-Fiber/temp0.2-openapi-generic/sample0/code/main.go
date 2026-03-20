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

type ErrorResponse struct {
	Error string `json:"error"`
}

type TokenType int

const (
	TokenNumber TokenType = iota
	TokenPlus
	TokenMinus
	TokenMultiply
	TokenDivide
	TokenLeftParen
	TokenRightParen
	TokenEOF
)

type Token struct {
	Type  TokenType
	Value float64
}

type Lexer struct {
	input string
	pos   int
}

func NewLexer(input string) *Lexer {
	return &Lexer{input: input, pos: 0}
}

func (l *Lexer) NextToken() (Token, error) {
	for l.pos < len(l.input) && unicode.IsSpace(rune(l.input[l.pos])) {
		l.pos++
	}

	if l.pos >= len(l.input) {
		return Token{Type: TokenEOF}, nil
	}

	ch := l.input[l.pos]

	switch ch {
	case '+':
		l.pos++
		return Token{Type: TokenPlus}, nil
	case '-':
		l.pos++
		return Token{Type: TokenMinus}, nil
	case '*':
		l.pos++
		return Token{Type: TokenMultiply}, nil
	case '/':
		l.pos++
		return Token{Type: TokenDivide}, nil
	case '(':
		l.pos++
		return Token{Type: TokenLeftParen}, nil
	case ')':
		l.pos++
		return Token{Type: TokenRightParen}, nil
	}

	if unicode.IsDigit(rune(ch)) || ch == '.' {
		start := l.pos
		for l.pos < len(l.input) && (unicode.IsDigit(rune(l.input[l.pos])) || l.input[l.pos] == '.') {
			l.pos++
		}
		numStr := l.input[start:l.pos]
		value, err := strconv.ParseFloat(numStr, 64)
		if err != nil {
			return Token{}, fmt.Errorf("invalid number: %s", numStr)
		}
		return Token{Type: TokenNumber, Value: value}, nil
	}

	return Token{}, fmt.Errorf("unexpected character: %c", ch)
}

type Parser struct {
	lexer        *Lexer
	currentToken Token
}

func NewParser(input string) (*Parser, error) {
	p := &Parser{lexer: NewLexer(input)}
	token, err := p.lexer.NextToken()
	if err != nil {
		return nil, err
	}
	p.currentToken = token
	return p, nil
}

func (p *Parser) advance() error {
	token, err := p.lexer.NextToken()
	if err != nil {
		return err
	}
	p.currentToken = token
	return nil
}

func (p *Parser) Parse() (float64, error) {
	result, err := p.parseExpression()
	if err != nil {
		return 0, err
	}
	if p.currentToken.Type != TokenEOF {
		return 0, fmt.Errorf("unexpected token at end of expression")
	}
	return result, nil
}

func (p *Parser) parseExpression() (float64, error) {
	return p.parseAddSubtract()
}

func (p *Parser) parseAddSubtract() (float64, error) {
	left, err := p.parseMultiplyDivide()
	if err != nil {
		return 0, err
	}

	for {
		if p.currentToken.Type == TokenPlus {
			if err := p.advance(); err != nil {
				return 0, err
			}
			right, err := p.parseMultiplyDivide()
			if err != nil {
				return 0, err
			}
			left = left + right
		} else if p.currentToken.Type == TokenMinus {
			if err := p.advance(); err != nil {
				return 0, err
			}
			right, err := p.parseMultiplyDivide()
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

func (p *Parser) parseMultiplyDivide() (float64, error) {
	left, err := p.parsePrimary()
	if err != nil {
		return 0, err
	}

	for {
		if p.currentToken.Type == TokenMultiply {
			if err := p.advance(); err != nil {
				return 0, err
			}
			right, err := p.parsePrimary()
			if err != nil {
				return 0, err
			}
			left = left * right
		} else if p.currentToken.Type == TokenDivide {
			if err := p.advance(); err != nil {
				return 0, err
			}
			right, err := p.parsePrimary()
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

func (p *Parser) parsePrimary() (float64, error) {
	if p.currentToken.Type == TokenNumber {
		value := p.currentToken.Value
		if err := p.advance(); err != nil {
			return 0, err
		}
		return value, nil
	}

	if p.currentToken.Type == TokenLeftParen {
		if err := p.advance(); err != nil {
			return 0, err
		}
		result, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		if p.currentToken.Type != TokenRightParen {
			return 0, fmt.Errorf("expected ')'")
		}
		if err := p.advance(); err != nil {
			return 0, err
		}
		return result, nil
	}

	if p.currentToken.Type == TokenMinus {
		if err := p.advance(); err != nil {
			return 0, err
		}
		value, err := p.parsePrimary()
		if err != nil {
			return 0, err
		}
		return -value, nil
	}

	if p.currentToken.Type == TokenPlus {
		if err := p.advance(); err != nil {
			return 0, err
		}
		return p.parsePrimary()
	}

	return 0, fmt.Errorf("unexpected token")
}

func evaluateExpression(expression string) (string, error) {
	trimmed := strings.TrimSpace(expression)
	if trimmed == "" {
		return "", fmt.Errorf("empty expression")
	}

	parser, err := NewParser(expression)
	if err != nil {
		return "", err
	}

	result, err := parser.Parse()
	if err != nil {
		return "", err
	}

	resultStr := strconv.FormatFloat(result, 'g', -1, 64)
	return resultStr, nil
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req CalculatorRequest

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid JSON",
			})
		}

		result, err := evaluateExpression(req.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: err.Error(),
			})
		}

		return c.JSON(CalculatorResponse{
			Result: result,
		})
	})

	app.Listen("0.0.0.0:5000")
}