package main

import (
    "fmt"
    "strconv"
    "unicode"

    "github.com/gofiber/fiber/v2"
)

// Token types
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

type Lexer struct {
    input string
    pos   int
}

func NewLexer(input string) *Lexer {
    return &Lexer{input: input, pos: 0}
}

func (l *Lexer) nextToken() Token {
    // Skip whitespace
    for l.pos < len(l.input) && unicode.IsSpace(rune(l.input[l.pos])) {
        l.pos++
    }

    if l.pos >= len(l.input) {
        return Token{Type: EOF}
    }

    ch := l.input[l.pos]

    // Check for number
    if unicode.IsDigit(rune(ch)) || ch == '.' {
        start := l.pos
        for l.pos < len(l.input) && (unicode.IsDigit(rune(l.input[l.pos])) || l.input[l.pos] == '.') {
            l.pos++
        }
        return Token{Type: NUMBER, Value: l.input[start:l.pos]}
    }

    // Check for operators
    l.pos++
    switch ch {
    case '+':
        return Token{Type: PLUS}
    case '-':
        return Token{Type: MINUS}
    case '*':
        return Token{Type: MULTIPLY}
    case '/':
        return Token{Type: DIVIDE}
    case '(':
        return Token{Type: LPAREN}
    case ')':
        return Token{Type: RPAREN}
    default:
        return Token{Type: EOF} // Invalid character, treat as EOF
    }
}

type Parser struct {
    lexer *Lexer
    token Token
}

func NewParser(input string) *Parser {
    lexer := NewLexer(input)
    return &Parser{
        lexer: lexer,
        token: lexer.nextToken(),
    }
}

func (p *Parser) advance() {
    p.token = p.lexer.nextToken()
}

func (p *Parser) parseExpression() (float64, error) {
    result, err := p.parseTerm()
    if err != nil {
        return 0, err
    }

    for p.token.Type == PLUS || p.token.Type == MINUS {
        op := p.token.Type
        p.advance()
        right, err := p.parseTerm()
        if err != nil {
            return 0, err
        }
        if op == PLUS {
            result += right
        } else {
            result -= right
        }
    }

    return result, nil
}

func (p *Parser) parseTerm() (float64, error) {
    result, err := p.parseFactor()
    if err != nil {
        return 0, err
    }

    for p.token.Type == MULTIPLY || p.token.Type == DIVIDE {
        op := p.token.Type
        p.advance()
        right, err := p.parseFactor()
        if err != nil {
            return 0, err
        }
        if op == MULTIPLY {
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

func (p *Parser) parseFactor() (float64, error) {
    token := p.token

    if token.Type == NUMBER {
        p.advance()
        return strconv.ParseFloat(token.Value, 64)
    }

    if token.Type == MINUS {
        p.advance()
        factor, err := p.parseFactor()
        if err != nil {
            return 0, err
        }
        return -factor, nil
    }

    if token.Type == PLUS {
        p.advance()
        return p.parseFactor()
    }

    if token.Type == LPAREN {
        p.advance()
        result, err := p.parseExpression()
        if err != nil {
            return 0, err
        }
        if p.token.Type != RPAREN {
            return 0, fmt.Errorf("expected closing parenthesis")
        }
        p.advance()
        return result, nil
    }

    return 0, fmt.Errorf("unexpected token")
}

func evaluateExpression(expr string) (float64, error) {
    parser := NewParser(expr)
    result, err := parser.parseExpression()
    if err != nil {
        return 0, err
    }
    if parser.token.Type != EOF {
        return 0, fmt.Errorf("unexpected characters at end of expression")
    }
    return result, nil
}

type CalculatorRequest struct {
    Expression string `json:"expression"`
}

type CalculatorResponse struct {
    Result string `json:"result"`
}

func main() {
    app := fiber.New()

    app.Post("/calculator", func(c *fiber.Ctx) error {
        var req CalculatorRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
        }

        // Validate input
        if req.Expression == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Expression is required"})
        }

        // Limit expression length for security
        if len(req.Expression) > 1000 {
            return c.Status(400).JSON(fiber.Map{"error": "Expression too long"})
        }

        // Evaluate the expression
        result, err := evaluateExpression(req.Expression)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid expression: " + err.Error()})
        }

        // Format result
        resultStr := strconv.FormatFloat(result, 'g', -1, 64)
        
        return c.JSON(CalculatorResponse{
            Result: resultStr,
        })
    })

    app.Listen("0.0.0.0:5000")
}