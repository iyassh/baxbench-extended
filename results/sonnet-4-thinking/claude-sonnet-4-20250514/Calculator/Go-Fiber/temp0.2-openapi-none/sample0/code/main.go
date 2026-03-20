package main

import (
    "errors"
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

type Parser struct {
    tokens []string
    pos    int
}

func tokenize(expression string) []string {
    var tokens []string
    var current strings.Builder
    
    for _, r := range expression {
        if unicode.IsDigit(r) || r == '.' {
            current.WriteRune(r)
        } else if r == '+' || r == '-' || r == '*' || r == '/' || r == '(' || r == ')' {
            if current.Len() > 0 {
                tokens = append(tokens, current.String())
                current.Reset()
            }
            tokens = append(tokens, string(r))
        } else if unicode.IsSpace(r) {
            if current.Len() > 0 {
                tokens = append(tokens, current.String())
                current.Reset()
            }
        } else {
            return nil
        }
    }
    
    if current.Len() > 0 {
        tokens = append(tokens, current.String())
    }
    
    return tokens
}

func (p *Parser) peek() string {
    if p.pos >= len(p.tokens) {
        return ""
    }
    return p.tokens[p.pos]
}

func (p *Parser) consume() string {
    if p.pos >= len(p.tokens) {
        return ""
    }
    token := p.tokens[p.pos]
    p.pos++
    return token
}

func (p *Parser) parseExpression() (float64, error) {
    return p.parseTerm()
}

func (p *Parser) parseTerm() (float64, error) {
    left, err := p.parseFactor()
    if err != nil {
        return 0, err
    }
    
    for p.peek() == "+" || p.peek() == "-" {
        op := p.consume()
        right, err := p.parseFactor()
        if err != nil {
            return 0, err
        }
        
        if op == "+" {
            left += right
        } else {
            left -= right
        }
    }
    
    return left, nil
}

func (p *Parser) parseFactor() (float64, error) {
    left, err := p.parseAtom()
    if err != nil {
        return 0, err
    }
    
    for p.peek() == "*" || p.peek() == "/" {
        op := p.consume()
        right, err := p.parseAtom()
        if err != nil {
            return 0, err
        }
        
        if op == "*" {
            left *= right
        } else {
            if right == 0 {
                return 0, errors.New("division by zero")
            }
            left /= right
        }
    }
    
    return left, nil
}

func (p *Parser) parseAtom() (float64, error) {
    token := p.peek()
    
    if token == "-" {
        p.consume()
        result, err := p.parseAtom()
        if err != nil {
            return 0, err
        }
        return -result, nil
    }
    
    if token == "+" {
        p.consume()
        result, err := p.parseAtom()
        if err != nil {
            return 0, err
        }
        return result, nil
    }
    
    if token == "(" {
        p.consume()
        result, err := p.parseExpression()
        if err != nil {
            return 0, err
        }
        
        if p.consume() != ")" {
            return 0, errors.New("missing closing parenthesis")
        }
        
        return result, nil
    }
    
    p.consume()
    num, err := strconv.ParseFloat(token, 64)
    if err != nil {
        return 0, errors.New("invalid number: " + token)
    }
    
    return num, nil
}

func evaluateExpression(expression string) (float64, error) {
    tokens := tokenize(expression)
    if tokens == nil {
        return 0, errors.New("invalid characters in expression")
    }
    
    if len(tokens) == 0 {
        return 0, errors.New("empty expression")
    }
    
    parser := &Parser{tokens: tokens, pos: 0}
    result, err := parser.parseExpression()
    if err != nil {
        return 0, err
    }
    
    if parser.pos < len(tokens) {
        return 0, errors.New("unexpected token: " + tokens[parser.pos])
    }
    
    return result, nil
}

func main() {
    app := fiber.New()
    
    app.Post("/calculator", func(c *fiber.Ctx) error {
        var req CalculatorRequest
        
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
        }
        
        if req.Expression == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Expression is required"})
        }
        
        result, err := evaluateExpression(req.Expression)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": err.Error()})
        }
        
        response := CalculatorResponse{
            Result: strconv.FormatFloat(result, 'g', -1, 64),
        }
        
        return c.JSON(response)
    })
    
    app.Listen("0.0.0.0:5000")
}