package main

import (
    "fmt"
    "strconv"
    "strings"
    "unicode"
    
    "github.com/gofiber/fiber/v2"
)

// Define request and response structures
type CalculateRequest struct {
    Expression string `json:"expression"`
}

type CalculateResponse struct {
    Result string `json:"result"`
}

// Simple expression evaluator
func evaluateExpression(expression string) (float64, error) {
    // Remove spaces
    expression = strings.ReplaceAll(expression, " ", "")
    
    // Tokenize
    tokens, err := tokenize(expression)
    if err != nil {
        return 0, err
    }
    
    // Parse and evaluate
    result, pos, err := parseExpression(tokens, 0)
    if err != nil {
        return 0, err
    }
    
    if pos != len(tokens) {
        return 0, fmt.Errorf("unexpected token at position %d", pos)
    }
    
    return result, nil
}

type Token struct {
    Type  string
    Value string
}

func tokenize(expr string) ([]Token, error) {
    var tokens []Token
    i := 0
    
    for i < len(expr) {
        ch := expr[i]
        
        // Numbers
        if unicode.IsDigit(rune(ch)) || ch == '.' {
            j := i
            for j < len(expr) && (unicode.IsDigit(rune(expr[j])) || expr[j] == '.') {
                j++
            }
            tokens = append(tokens, Token{Type: "NUMBER", Value: expr[i:j]})
            i = j
            continue
        }
        
        // Operators
        switch ch {
        case '+', '-', '*', '/', '(', ')':
            tokens = append(tokens, Token{Type: "OPERATOR", Value: string(ch)})
            i++
        default:
            return nil, fmt.Errorf("invalid character: %c", ch)
        }
    }
    
    return tokens, nil
}

func parseExpression(tokens []Token, pos int) (float64, int, error) {
    left, pos, err := parseTerm(tokens, pos)
    if err != nil {
        return 0, pos, err
    }
    
    for pos < len(tokens) && (tokens[pos].Value == "+" || tokens[pos].Value == "-") {
        op := tokens[pos].Value
        pos++
        
        right, newPos, err := parseTerm(tokens, pos)
        if err != nil {
            return 0, newPos, err
        }
        pos = newPos
        
        if op == "+" {
            left = left + right
        } else {
            left = left - right
        }
    }
    
    return left, pos, nil
}

func parseTerm(tokens []Token, pos int) (float64, int, error) {
    left, pos, err := parseFactor(tokens, pos)
    if err != nil {
        return 0, pos, err
    }
    
    for pos < len(tokens) && (tokens[pos].Value == "*" || tokens[pos].Value == "/") {
        op := tokens[pos].Value
        pos++
        
        right, newPos, err := parseFactor(tokens, pos)
        if err != nil {
            return 0, newPos, err
        }
        pos = newPos
        
        if op == "*" {
            left = left * right
        } else {
            if right == 0 {
                return 0, pos, fmt.Errorf("division by zero")
            }
            left = left / right
        }
    }
    
    return left, pos, nil
}

func parseFactor(tokens []Token, pos int) (float64, int, error) {
    if pos >= len(tokens) {
        return 0, pos, fmt.Errorf("unexpected end of expression")
    }
    
    token := tokens[pos]
    
    if token.Type == "NUMBER" {
        value, err := strconv.ParseFloat(token.Value, 64)
        if err != nil {
            return 0, pos, err
        }
        return value, pos + 1, nil
    }
    
    if token.Value == "(" {
        pos++
        value, pos, err := parseExpression(tokens, pos)
        if err != nil {
            return 0, pos, err
        }
        
        if pos >= len(tokens) || tokens[pos].Value != ")" {
            return 0, pos, fmt.Errorf("missing closing parenthesis")
        }
        
        return value, pos + 1, nil
    }
    
    if token.Value == "-" {
        pos++
        value, pos, err := parseFactor(tokens, pos)
        if err != nil {
            return 0, pos, err
        }
        return -value, pos, nil
    }
    
    return 0, pos, fmt.Errorf("unexpected token: %s", token.Value)
}

func main() {
    app := fiber.New()

    // Calculator endpoint
    app.Post("/calculator", func(c *fiber.Ctx) error {
        var req CalculateRequest
        
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
        }
        
        result, err := evaluateExpression(req.Expression)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
        }
        
        // Format result as string
        resultStr := fmt.Sprintf("%g", result)
        
        return c.JSON(CalculateResponse{Result: resultStr})
    })

    app.Listen("0.0.0.0:5000")
}