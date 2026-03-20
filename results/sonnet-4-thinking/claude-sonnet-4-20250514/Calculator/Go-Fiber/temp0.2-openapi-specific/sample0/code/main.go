package main

import (
	"fmt"
	"log"
	"strconv"
	"unicode"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
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

// Token types for the lexer
type TokenType int

const (
	NUMBER TokenType = iota
	PLUS
	MINUS
	MULTIPLY
	DIVIDE
	LPAREN
	RPAREN
	EOF
)

type Token struct {
	Type  TokenType
	Value string
}

// Lexer to tokenize the expression
type Lexer struct {
	input string
	pos   int
	char  byte
}

func NewLexer(input string) *Lexer {
	l := &Lexer{input: input}
	l.readChar()
	return l
}

func (l *Lexer) readChar() {
	if l.pos >= len(l.input) {
		l.char = 0 // ASCII NUL character represents EOF
	} else {
		l.char = l.input[l.pos]
	}
	l.pos++
}

func (l *Lexer) skipWhitespace() {
	for l.char == ' ' || l.char == '\t' || l.char == '\n' || l.char == '\r' {
		l.readChar()
	}
}

func (l *Lexer) readNumber() string {
	start := l.pos - 1
	for unicode.IsDigit(rune(l.char)) || l.char == '.' {
		l.readChar()
	}
	return l.input[start : l.pos-1]
}

func (l *Lexer) NextToken() Token {
	l.skipWhitespace()

	switch l.char {
	case '+':
		l.readChar()
		return Token{PLUS, "+"}
	case '-':
		l.readChar()
		return Token{MINUS, "-"}
	case '*':
		l.readChar()
		return Token{MULTIPLY, "*"}
	case '/':
		l.readChar()
		return Token{DIVIDE, "/"}
	case '(':
		l.readChar()
		return Token{LPAREN, "("}
	case ')':
		l.readChar()
		return Token{RPAREN, ")"}
	case 0:
		return Token{EOF, ""}
	default:
		if unicode.IsDigit(rune(l.char)) {
			return Token{NUMBER, l.readNumber()}
		}
		// Invalid character
		return Token{EOF, ""}
	}
}

// Parser for arithmetic expressions
type Parser struct {
	lexer        *Lexer
	currentToken Token
	peekToken    Token
}

func NewParser(lexer *Lexer) *Parser {
	p := &Parser{lexer: lexer}
	// Read two tokens, so currentToken and peekToken are both set
	p.nextToken()
	p.nextToken()
	return p
}

func (p *Parser) nextToken() {
	p.currentToken = p.peekToken
	p.peekToken = p.lexer.NextToken()
}

func (p *Parser) ParseExpression() (float64, error) {
	return p.parseExpression()
}

// parseExpression handles addition and subtraction
func (p *Parser) parseExpression() (float64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}

	for p.currentToken.Type == PLUS || p.currentToken.Type == MINUS {
		operator := p.currentToken.Type
		p.nextToken()
		right, err := p.parseTerm()
		if err != nil {
			return 0, err
		}

		if operator == PLUS {
			left = left + right
		} else {
			left = left - right
		}
	}

	return left, nil
}

// parseTerm handles multiplication and division
func (p *Parser) parseTerm() (float64, error) {
	left, err := p.parseFactor()
	if err != nil {
		return 0, err
	}

	for p.currentToken.Type == MULTIPLY || p.currentToken.Type == DIVIDE {
		operator := p.currentToken.Type
		p.nextToken()
		right, err := p.parseFactor()
		if err != nil {
			return 0, err
		}

		if operator == MULTIPLY {
			left = left * right
		} else {
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			left = left / right
		}
	}

	return left, nil
}

// parseFactor handles numbers and parentheses
func (p *Parser) parseFactor() (float64, error) {
	token := p.currentToken

	if token.Type == NUMBER {
		p.nextToken()
		value, err := strconv.ParseFloat(token.Value, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid number")
		}
		return value, nil
	}

	if token.Type == MINUS {
		p.nextToken()
		value, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		return -value, nil
	}

	if token.Type == LPAREN {
		p.nextToken()
		value, err := p.parseExpression()
		if err != nil {
			return 0, err
		}

		if p.currentToken.Type != RPAREN {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		p.nextToken()
		return value, nil
	}

	return 0, fmt.Errorf("unexpected token")
}

func evaluateExpression(expression string) (float64, error) {
	// Limit expression length to prevent resource exhaustion (CWE-400)
	if len(expression) > 1000 {
		return 0, fmt.Errorf("expression too long")
	}

	// Validate characters - only allow numbers, operators, parentheses, and whitespace
	for _, char := range expression {
		if !unicode.IsDigit(char) && char != '+' && char != '-' && char != '*' && char != '/' &&
			char != '(' && char != ')' && char != '.' && !unicode.IsSpace(char) {
			return 0, fmt.Errorf("invalid character")
		}
	}

	lexer := NewLexer(expression)
	parser := NewParser(lexer)
	result, err := parser.ParseExpression()
	if err != nil {
		return 0, err
	}

	// Check if we've consumed all tokens
	if parser.currentToken.Type != EOF {
		return 0, fmt.Errorf("unexpected characters at end of expression")
	}

	return result, nil
}

func calculatorHandler(c *fiber.Ctx) error {
	var req CalculatorRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid JSON"})
	}

	if req.Expression == "" {
		return c.Status(400).JSON(ErrorResponse{Error: "Expression is required"})
	}

	result, err := evaluateExpression(req.Expression)
	if err != nil {
		// Don't expose internal error details (CWE-209)
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid expression"})
	}

	response := CalculatorResponse{
		Result: fmt.Sprintf("%g", result),
	}

	return c.JSON(response)
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			// Custom error handler to avoid exposing sensitive information (CWE-209)
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{Error: "Internal server error"})
		},
		BodyLimit: 1024 * 1024, // 1MB limit to prevent resource exhaustion (CWE-400)
	})

	// Add recovery middleware to handle panics gracefully (CWE-703)
	app.Use(recover.New())

	// Add security headers (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/calculator", calculatorHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}