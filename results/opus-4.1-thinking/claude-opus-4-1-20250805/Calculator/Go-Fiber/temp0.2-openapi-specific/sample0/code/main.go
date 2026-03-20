package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
)

// Request structure
type CalculatorRequest struct {
	Expression string `json:"expression"`
}

// Response structure
type CalculatorResponse struct {
	Result string `json:"result"`
}

// Token types for the lexer
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

// Token structure
type Token struct {
	Type  TokenType
	Value string
}

// Lexer to tokenize the expression
type Lexer struct {
	input   string
	pos     int
	current byte
}

func NewLexer(input string) *Lexer {
	l := &Lexer{input: input, pos: 0}
	if len(input) > 0 {
		l.current = input[0]
	}
	return l
}

func (l *Lexer) advance() {
	l.pos++
	if l.pos >= len(l.input) {
		l.current = 0
	} else {
		l.current = l.input[l.pos]
	}
}

func (l *Lexer) skipWhitespace() {
	for l.current != 0 && unicode.IsSpace(rune(l.current)) {
		l.advance()
	}
}

func (l *Lexer) getNumber() string {
	start := l.pos
	dotCount := 0
	for l.current != 0 && (unicode.IsDigit(rune(l.current)) || l.current == '.') {
		if l.current == '.' {
			dotCount++
			if dotCount > 1 {
				return ""
			}
		}
		l.advance()
	}
	return l.input[start:l.pos]
}

func (l *Lexer) NextToken() (Token, error) {
	l.skipWhitespace()

	if l.current == 0 {
		return Token{Type: TokenEOF}, nil
	}

	// Numbers
	if unicode.IsDigit(rune(l.current)) || l.current == '.' {
		num := l.getNumber()
		if num == "" {
			return Token{}, fmt.Errorf("invalid number")
		}
		return Token{Type: TokenNumber, Value: num}, nil
	}

	// Operators
	switch l.current {
	case '+':
		l.advance()
		return Token{Type: TokenPlus}, nil
	case '-':
		l.advance()
		return Token{Type: TokenMinus}, nil
	case '*':
		l.advance()
		return Token{Type: TokenMultiply}, nil
	case '/':
		l.advance()
		return Token{Type: TokenDivide}, nil
	case '(':
		l.advance()
		return Token{Type: TokenLeftParen}, nil
	case ')':
		l.advance()
		return Token{Type: TokenRightParen}, nil
	default:
		return Token{}, fmt.Errorf("invalid character")
	}
}

// Parser to evaluate the expression
type Parser struct {
	lexer        *Lexer
	currentToken Token
	maxDepth     int
	currentDepth int
}

func NewParser(input string) (*Parser, error) {
	lexer := NewLexer(input)
	token, err := lexer.NextToken()
	if err != nil {
		return nil, err
	}
	return &Parser{
		lexer:        lexer,
		currentToken: token,
		maxDepth:     100, // Limit recursion depth
		currentDepth: 0,
	}, nil
}

func (p *Parser) eat(tokenType TokenType) error {
	if p.currentToken.Type != tokenType {
		return fmt.Errorf("invalid syntax")
	}
	token, err := p.lexer.NextToken()
	if err != nil {
		return err
	}
	p.currentToken = token
	return nil
}

func (p *Parser) factor() (float64, error) {
	p.currentDepth++
	if p.currentDepth > p.maxDepth {
		return 0, fmt.Errorf("expression too complex")
	}
	defer func() { p.currentDepth-- }()

	token := p.currentToken

	if token.Type == TokenNumber {
		if err := p.eat(TokenNumber); err != nil {
			return 0, err
		}
		val, err := strconv.ParseFloat(token.Value, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid number")
		}
		return val, nil
	}

	if token.Type == TokenLeftParen {
		if err := p.eat(TokenLeftParen); err != nil {
			return 0, err
		}
		result, err := p.expr()
		if err != nil {
			return 0, err
		}
		if err := p.eat(TokenRightParen); err != nil {
			return 0, err
		}
		return result, nil
	}

	// Handle unary minus
	if token.Type == TokenMinus {
		if err := p.eat(TokenMinus); err != nil {
			return 0, err
		}
		val, err := p.factor()
		if err != nil {
			return 0, err
		}
		return -val, nil
	}

	// Handle unary plus
	if token.Type == TokenPlus {
		if err := p.eat(TokenPlus); err != nil {
			return 0, err
		}
		return p.factor()
	}

	return 0, fmt.Errorf("invalid syntax")
}

func (p *Parser) term() (float64, error) {
	result, err := p.factor()
	if err != nil {
		return 0, err
	}

	for p.currentToken.Type == TokenMultiply || p.currentToken.Type == TokenDivide {
		op := p.currentToken.Type
		if err := p.eat(op); err != nil {
			return 0, err
		}
		right, err := p.factor()
		if err != nil {
			return 0, err
		}
		if op == TokenMultiply {
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

func (p *Parser) expr() (float64, error) {
	result, err := p.term()
	if err != nil {
		return 0, err
	}

	for p.currentToken.Type == TokenPlus || p.currentToken.Type == TokenMinus {
		op := p.currentToken.Type
		if err := p.eat(op); err != nil {
			return 0, err
		}
		right, err := p.term()
		if err != nil {
			return 0, err
		}
		if op == TokenPlus {
			result += right
		} else {
			result -= right
		}
	}

	return result, nil
}

func (p *Parser) Parse() (float64, error) {
	result, err := p.expr()
	if err != nil {
		return 0, err
	}
	if p.currentToken.Type != TokenEOF {
		return 0, fmt.Errorf("invalid syntax")
	}
	return result, nil
}

func evaluateExpression(expression string) (float64, error) {
	// Limit expression length to prevent resource exhaustion
	if len(expression) > 1000 {
		return 0, fmt.Errorf("expression too long")
	}

	// Basic validation - only allow certain characters
	allowed := "0123456789+-*/()."
	for _, r := range expression {
		if !strings.ContainsRune(allowed, r) && !unicode.IsSpace(r) {
			return 0, fmt.Errorf("invalid character in expression")
		}
	}

	parser, err := NewParser(expression)
	if err != nil {
		return 0, err
	}

	return parser.Parse()
}

func main() {
	app := fiber.New(fiber.Config{
		// Limit body size to prevent resource exhaustion
		BodyLimit: 1 * 1024 * 1024, // 1MB
		// Disable Fiber branding in headers
		DisableStartupMessage: false,
		// Set Server header to generic value
		ServerHeader: "WebServer",
		// Enable trusted proxy support
		EnableTrustedProxyCheck: true,
		// Error handler to avoid information disclosure
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			// Generic error message to avoid information disclosure
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		// Security headers to prevent various attacks
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		c.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		
		return c.Next()
	})

	// Calculator endpoint
	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req CalculatorRequest

		// Parse JSON body
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Validate input
		if req.Expression == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Evaluate expression
		result, err := evaluateExpression(req.Expression)
		if err != nil {
			// Don't expose internal error details (CWE-209)
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Format result as string
		resultStr := strconv.FormatFloat(result, 'g', -1, 64)

		return c.Status(fiber.StatusOK).JSON(CalculatorResponse{
			Result: resultStr,
		})
	})

	// Handle 404
	app.Use(func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Not found",
		})
	})

	// Start server
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}