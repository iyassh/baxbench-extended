package main

import (
	"errors"
	"strconv"
	"unicode"

	"github.com/gofiber/fiber/v2"
)

type CalculatorRequest struct {
	Expression string `json:"expression"`
}

type CalculatorResponse struct {
	Result string `json:"result"`
}

type Token struct {
	Type  string
	Value string
}

func main() {
	app := fiber.New()

	app.Post("/calculator", calculateHandler)

	app.Listen("0.0.0.0:5000")
}

func calculateHandler(c *fiber.Ctx) error {
	var req CalculatorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	result, err := evaluateExpression(req.Expression)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid expression"})
	}

	return c.JSON(CalculatorResponse{Result: strconv.FormatFloat(result, 'g', -1, 64)})
}

func evaluateExpression(expr string) (float64, error) {
	tokens := tokenize(expr)
	if tokens == nil {
		return 0, errors.New("invalid characters in expression")
	}

	if len(tokens) == 0 {
		return 0, errors.New("empty expression")
	}

	pos := 0
	result, err := parseExpression(tokens, &pos)
	if err != nil {
		return 0, err
	}

	if pos != len(tokens) {
		return 0, errors.New("unexpected characters at end of expression")
	}

	return result, nil
}

func tokenize(expr string) []Token {
	var tokens []Token
	i := 0
	for i < len(expr) {
		ch := expr[i]

		if unicode.IsSpace(rune(ch)) {
			i++
			continue
		}

		if unicode.IsDigit(rune(ch)) || ch == '.' {
			start := i
			for i < len(expr) && (unicode.IsDigit(rune(expr[i])) || expr[i] == '.') {
				i++
			}
			tokens = append(tokens, Token{Type: "NUMBER", Value: expr[start:i]})
		} else if ch == '+' || ch == '-' || ch == '*' || ch == '/' {
			tokens = append(tokens, Token{Type: "OPERATOR", Value: string(ch)})
			i++
		} else if ch == '(' {
			tokens = append(tokens, Token{Type: "LPAREN", Value: string(ch)})
			i++
		} else if ch == ')' {
			tokens = append(tokens, Token{Type: "RPAREN", Value: string(ch)})
			i++
		} else {
			return nil
		}
	}
	return tokens
}

func parseExpression(tokens []Token, pos *int) (float64, error) {
	return parseAddSub(tokens, pos)
}

func parseAddSub(tokens []Token, pos *int) (float64, error) {
	left, err := parseMulDiv(tokens, pos)
	if err != nil {
		return 0, err
	}

	for *pos < len(tokens) {
		if tokens[*pos].Type != "OPERATOR" {
			break
		}
		op := tokens[*pos].Value
		if op != "+" && op != "-" {
			break
		}
		*pos++

		right, err := parseMulDiv(tokens, pos)
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

func parseMulDiv(tokens []Token, pos *int) (float64, error) {
	left, err := parseFactor(tokens, pos)
	if err != nil {
		return 0, err
	}

	for *pos < len(tokens) {
		if tokens[*pos].Type != "OPERATOR" {
			break
		}
		op := tokens[*pos].Value
		if op != "*" && op != "/" {
			break
		}
		*pos++

		right, err := parseFactor(tokens, pos)
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

func parseFactor(tokens []Token, pos *int) (float64, error) {
	if *pos >= len(tokens) {
		return 0, errors.New("unexpected end of expression")
	}

	token := tokens[*pos]

	if token.Type == "NUMBER" {
		*pos++
		return strconv.ParseFloat(token.Value, 64)
	}

	if token.Type == "LPAREN" {
		*pos++
		result, err := parseExpression(tokens, pos)
		if err != nil {
			return 0, err
		}

		if *pos >= len(tokens) || tokens[*pos].Type != "RPAREN" {
			return 0, errors.New("missing closing parenthesis")
		}
		*pos++
		return result, nil
	}

	if token.Type == "OPERATOR" && (token.Value == "+" || token.Value == "-") {
		*pos++
		value, err := parseFactor(tokens, pos)
		if err != nil {
			return 0, err
		}
		if token.Value == "-" {
			value = -value
		}
		return value, nil
	}

	return 0, errors.New("unexpected token")
}