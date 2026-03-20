package main

import (
    "fmt"
    "github.com/gofiber/fiber/v2"
    "log"
    "strconv"
    "time"
    "unicode"
)

// Request/Response structures
type CalculatorRequest struct {
    Expression string `json:"expression"`
}

type CalculatorResponse struct {
    Result string `json:"result"`
}

// Token types for the parser
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

// Tokenizer
func tokenize(expression string) ([]Token, error) {
    var tokens []Token
    runes := []rune(expression)
    i := 0
    
    for i < len(runes) {
        // Skip whitespace
        if unicode.IsSpace(runes[i]) {
            i++
            continue
        }
        
        // Numbers (including decimals)
        if unicode.IsDigit(runes[i]) || runes[i] == '.' {
            start := i
            hasDecimal := runes[i] == '.'
            i++
            for i < len(runes) && (unicode.IsDigit(runes[i]) || (!hasDecimal && runes[i] == '.')) {
                if runes[i] == '.' {
                    hasDecimal = true
                }
                i++
            }
            tokens = append(tokens, Token{Type: NUMBER, Value: string(runes[start:i])})
            continue
        }
        
        // Operators and parentheses
        switch runes[i] {
        case '+':
            tokens = append(tokens, Token{Type: PLUS})
        case '-':
            tokens = append(tokens, Token{Type: MINUS})
        case '*':
            tokens = append(tokens, Token{Type: MULTIPLY})
        case '/':
            tokens = append(tokens, Token{Type: DIVIDE})
        case '(':
            tokens = append(tokens, Token{Type: LPAREN})
        case ')':
            tokens = append(tokens, Token{Type: RPAREN})
        default:
            return nil, fmt.Errorf("invalid character: %c", runes[i])
        }
        i++
    }
    
    tokens = append(tokens, Token{Type: EOF})
    return tokens, nil
}

// Parser using recursive descent
type Parser struct {
    tokens []Token
    pos    int
}

func NewParser(tokens []Token) *Parser {
    return &Parser{tokens: tokens, pos: 0}
}

func (p *Parser) current() Token {
    if p.pos < len(p.tokens) {
        return p.tokens[p.pos]
    }
    return Token{Type: EOF}
}

func (p *Parser) consume() {
    p.pos++
}

func (p *Parser) parseExpression() (float64, error) {
    return p.parseAdditive()
}

func (p *Parser) parseAdditive() (float64, error) {
    left, err := p.parseMultiplicative()
    if err != nil {
        return 0, err
    }
    
    for {
        switch p.current().Type {
        case PLUS:
            p.consume()
            right, err := p.parseMultiplicative()
            if err != nil {
                return 0, err
            }
            left += right
        case MINUS:
            p.consume()
            right, err := p.parseMultiplicative()
            if err != nil {
                return 0, err
            }
            left -= right
        default:
            return left, nil
        }
    }
}

func (p *Parser) parseMultiplicative() (float64, error) {
    left, err := p.parseUnary()
    if err != nil {
        return 0, err
    }
    
    for {
        switch p.current().Type {
        case MULTIPLY:
            p.consume()
            right, err := p.parseUnary()
            if err != nil {
                return 0, err
            }
            left *= right
        case DIVIDE:
            p.consume()
            right, err := p.parseUnary()
            if err != nil {
                return 0, err
            }
            if right == 0 {
                return 0, fmt.Errorf("division by zero")
            }
            left /= right
        default:
            return left, nil
        }
    }
}

func (p *Parser) parseUnary() (float64, error) {
    switch p.current().Type {
    case MINUS:
        p.consume()
        value, err := p.parseUnary()
        if err != nil {
            return 0, err
        }
        return -value, nil
    case PLUS:
        p.consume()
        return p.parseUnary()
    default:
        return p.parsePrimary()
    }
}

func (p *Parser) parsePrimary() (float64, error) {
    switch p.current().Type {
    case NUMBER:
        value, err := strconv.ParseFloat(p.current().Value, 64)
        if err != nil {
            return 0, fmt.Errorf("invalid number")
        }
        p.consume()
        return value, nil
    case LPAREN:
        p.consume()
        value, err := p.parseExpression()
        if err != nil {
            return 0, err
        }
        if p.current().Type != RPAREN {
            return 0, fmt.Errorf("expected closing parenthesis")
        }
        p.consume()
        return value, nil
    default:
        return 0, fmt.Errorf("unexpected token")
    }
}

// Safe expression evaluator
func evaluateExpression(expression string) (float64, error) {
    // Limit expression length to prevent resource exhaustion
    if len(expression) > 1000 {
        return 0, fmt.Errorf("expression too long")
    }
    
    // Tokenize
    tokens, err := tokenize(expression)
    if err != nil {
        return 0, err
    }
    
    // Parse and evaluate
    parser := NewParser(tokens)
    result, err := parser.parseExpression()
    if err != nil {
        return 0, err
    }
    
    // Check if we consumed all tokens
    if parser.current().Type != EOF {
        return 0, fmt.Errorf("unexpected token at end of expression")
    }
    
    return result, nil
}

func main() {
    app := fiber.New(fiber.Config{
        // Disable Fiber's default error handler to prevent information disclosure
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            // Generic error message to prevent information disclosure
            return c.Status(code).JSON(fiber.Map{
                "error": "An error occurred",
            })
        },
    })
    
    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return c.Next()
    })
    
    // Calculator endpoint
    app.Post("/calculator", func(c *fiber.Ctx) error {
        // Set timeout for request processing to prevent resource exhaustion
        ctx := c.Context()
        deadline := time.Now().Add(5 * time.Second)
        ctx.SetDeadline(deadline)
        
        var req CalculatorRequest
        if err := c.BodyParser(&req); err != nil {
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
        
        // Evaluate expression with timeout
        resultChan := make(chan float64, 1)
        errorChan := make(chan error, 1)
        
        go func() {
            result, err := evaluateExpression(req.Expression)
            if err != nil {
                errorChan <- err
            } else {
                resultChan <- result
            }
        }()
        
        select {
        case result := <-resultChan:
            // Format result as string
            resultStr := fmt.Sprintf("%g", result)
            return c.JSON(CalculatorResponse{Result: resultStr})
        case <-errorChan:
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input",
            })
        case <-ctx.Done():
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input",
            })
        }
    })
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}