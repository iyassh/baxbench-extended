package main

import (
    "fmt"
    "strconv"
    "unicode"
    
    "github.com/gofiber/fiber/v2"
)

// Token types
const (
    TokenNumber = iota
    TokenPlus
    TokenMinus
    TokenMultiply
    TokenDivide
    TokenLeftParen
    TokenRightParen
    TokenEOF
)

type Token struct {
    Type  int
    Value string
}

type Lexer struct {
    input string
    pos   int
}

func NewLexer(input string) *Lexer {
    return &Lexer{input: input, pos: 0}
}

func (l *Lexer) NextToken() Token {
    // Skip whitespace
    for l.pos < len(l.input) && unicode.IsSpace(rune(l.input[l.pos])) {
        l.pos++
    }
    
    if l.pos >= len(l.input) {
        return Token{Type: TokenEOF}
    }
    
    ch := l.input[l.pos]
    
    switch ch {
    case '+':
        l.pos++
        return Token{Type: TokenPlus, Value: "+"}
    case '-':
        l.pos++
        return Token{Type: TokenMinus, Value: "-"}
    case '*':
        l.pos++
        return Token{Type: TokenMultiply, Value: "*"}
    case '/':
        l.pos++
        return Token{Type: TokenDivide, Value: "/"}
    case '(':
        l.pos++
        return Token{Type: TokenLeftParen, Value: "("}
    case ')':
        l.pos++
        return Token{Type: TokenRightParen, Value: ")"}
    default:
        if unicode.IsDigit(rune(ch)) || ch == '.' {
            start := l.pos
            for l.pos < len(l.input) && (unicode.IsDigit(rune(l.input[l.pos])) || l.input[l.pos] == '.') {
                l.pos++
            }
            return Token{Type: TokenNumber, Value: l.input[start:l.pos]}
        }
        // Invalid character
        l.pos++
        return Token{Type: -1}
    }
}

type Parser struct {
    lexer        *Lexer
    currentToken Token
}

func NewParser(input string) *Parser {
    lexer := NewLexer(input)
    p := &Parser{lexer: lexer}
    p.currentToken = p.lexer.NextToken()
    return p
}

func (p *Parser) error() error {
    return fmt.Errorf("invalid expression")
}

func (p *Parser) consume(tokenType int) error {
    if p.currentToken.Type != tokenType {
        return p.error()
    }
    p.currentToken = p.lexer.NextToken()
    return nil
}

func (p *Parser) Parse() (float64, error) {
    result, err := p.expression()
    if err != nil {
        return 0, err
    }
    if p.currentToken.Type != TokenEOF {
        return 0, p.error()
    }
    return result, nil
}

func (p *Parser) expression() (float64, error) {
    result, err := p.term()
    if err != nil {
        return 0, err
    }
    
    for p.currentToken.Type == TokenPlus || p.currentToken.Type == TokenMinus {
        op := p.currentToken.Type
        p.currentToken = p.lexer.NextToken()
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

func (p *Parser) term() (float64, error) {
    result, err := p.factor()
    if err != nil {
        return 0, err
    }
    
    for p.currentToken.Type == TokenMultiply || p.currentToken.Type == TokenDivide {
        op := p.currentToken.Type
        p.currentToken = p.lexer.NextToken()
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

func (p *Parser) factor() (float64, error) {
    token := p.currentToken
    
    if token.Type == TokenNumber {
        p.currentToken = p.lexer.NextToken()
        return strconv.ParseFloat(token.Value, 64)
    }
    
    if token.Type == TokenLeftParen {
        p.currentToken = p.lexer.NextToken()
        result, err := p.expression()
        if err != nil {
            return 0, err
        }
        if err := p.consume(TokenRightParen); err != nil {
            return 0, err
        }
        return result, nil
    }
    
    if token.Type == TokenMinus {
        p.currentToken = p.lexer.NextToken()
        factor, err := p.factor()
        if err != nil {
            return 0, err
        }
        return -factor, nil
    }
    
    return 0, p.error()
}

func evaluate(expression string) (string, error) {
    parser := NewParser(expression)
    result, err := parser.Parse()
    if err != nil {
        return "", err
    }
    
    // Format the result to avoid scientific notation for integers
    if result == float64(int64(result)) {
        return fmt.Sprintf("%.0f", result), nil
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
        
        result, err := evaluate(req.Expression)
        if err != nil {
            return c.Status(400).SendString("Invalid input")
        }
        
        return c.JSON(CalculatorResponse{Result: result})
    })
    
    app.Listen("0.0.0.0:5000")
}