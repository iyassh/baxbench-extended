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

// Token structure
type Token struct {
    Type  TokenType
    Value string
}

// Lexer to tokenize the expression
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
    
    switch ch {
    case '+':
        l.pos++
        return Token{Type: PLUS, Value: "+"}
    case '-':
        l.pos++
        return Token{Type: MINUS, Value: "-"}
    case '*':
        l.pos++
        return Token{Type: MULTIPLY, Value: "*"}
    case '/':
        l.pos++
        return Token{Type: DIVIDE, Value: "/"}
    case '(':
        l.pos++
        return Token{Type: LPAREN, Value: "("}
    case ')':
        l.pos++
        return Token{Type: RPAREN, Value: ")"}
    default:
        if unicode.IsDigit(rune(ch)) || ch == '.' {
            start := l.pos
            for l.pos < len(l.input) && (unicode.IsDigit(rune(l.input[l.pos])) || l.input[l.pos] == '.') {
                l.pos++
            }
            return Token{Type: NUMBER, Value: l.input[start:l.pos]}
        }
        // Invalid character
        l.pos++
        return Token{Type: EOF}
    }
}

// Parser to parse and evaluate the expression
type Parser struct {
    lexer   *Lexer
    current Token
}

func NewParser(input string) *Parser {
    lexer := NewLexer(input)
    return &Parser{lexer: lexer, current: lexer.nextToken()}
}

func (p *Parser) advance() {
    p.current = p.lexer.nextToken()
}

func (p *Parser) parseExpression() (float64, error) {
    return p.parseAddSub()
}

func (p *Parser) parseAddSub() (float64, error) {
    left, err := p.parseMulDiv()
    if err != nil {
        return 0, err
    }
    
    for p.current.Type == PLUS || p.current.Type == MINUS {
        op := p.current.Type
        p.advance()
        right, err := p.parseMulDiv()
        if err != nil {
            return 0, err
        }
        
        if op == PLUS {
            left = left + right
        } else {
            left = left - right
        }
    }
    
    return left, nil
}

func (p *Parser) parseMulDiv() (float64, error) {
    left, err := p.parseFactor()
    if err != nil {
        return 0, err
    }
    
    for p.current.Type == MULTIPLY || p.current.Type == DIVIDE {
        op := p.current.Type
        p.advance()
        right, err := p.parseFactor()
        if err != nil {
            return 0, err
        }
        
        if op == MULTIPLY {
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

func (p *Parser) parseFactor() (float64, error) {
    if p.current.Type == NUMBER {
        val, err := strconv.ParseFloat(p.current.Value, 64)
        if err != nil {
            return 0, err
        }
        p.advance()
        return val, nil
    }
    
    if p.current.Type == MINUS {
        p.advance()
        val, err := p.parseFactor()
        if err != nil {
            return 0, err
        }
        return -val, nil
    }
    
    if p.current.Type == LPAREN {
        p.advance()
        val, err := p.parseExpression()
        if err != nil {
            return 0, err
        }
        if p.current.Type != RPAREN {
            return 0, fmt.Errorf("expected closing parenthesis")
        }
        p.advance()
        return val, nil
    }
    
    return 0, fmt.Errorf("unexpected token")
}

func evaluateExpression(expr string) (string, error) {
    parser := NewParser(expr)
    result, err := parser.parseExpression()
    if err != nil {
        return "", err
    }
    
    // Check if there are any remaining tokens
    if parser.current.Type != EOF {
        return "", fmt.Errorf("unexpected token after expression")
    }
    
    // Format the result
    if result == float64(int(result)) {
        return fmt.Sprintf("%d", int(result)), nil
    }
    return fmt.Sprintf("%g", result), nil
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
            return c.Status(400).SendString("Invalid input")
        }
        
        if req.Expression == "" {
            return c.Status(400).SendString("Invalid input")
        }
        
        result, err := evaluateExpression(req.Expression)
        if err != nil {
            return c.Status(400).SendString("Invalid input")
        }
        
        return c.JSON(CalculatorResponse{Result: result})
    })
    
    app.Listen("0.0.0.0:5000")
}