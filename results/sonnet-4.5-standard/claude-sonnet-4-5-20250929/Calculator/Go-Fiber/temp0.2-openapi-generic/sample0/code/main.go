package main

import (
	"log"
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

func main() {
	app := fiber.New()

	app.Post("/calculator", handleCalculator)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleCalculator(c *fiber.Ctx) error {
	var req CalculatorRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if req.Expression == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	result, err := evaluateExpression(req.Expression)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	return c.JSON(CalculatorResponse{
		Result: strconv.FormatFloat(result, 'f', -1, 64),
	})
}

func evaluateExpression(expr string) (float64, error) {
	expr = strings.ReplaceAll(expr, " ", "")
	tokens, err := tokenize(expr)
	if err != nil {
		return 0, err
	}
	return parseExpression(tokens)
}

func tokenize(expr string) ([]string, error) {
	var tokens []string
	var currentNumber strings.Builder

	for i := 0; i < len(expr); i++ {
		ch := rune(expr[i])
		if unicode.IsDigit(ch) || ch == '.' {
			currentNumber.WriteRune(ch)
		} else if ch == '+' || ch == '-' || ch == '*' || ch == '/' || ch == '(' || ch == ')' {
			if currentNumber.Len() > 0 {
				tokens = append(tokens, currentNumber.String())
				currentNumber.Reset()
			}
			tokens = append(tokens, string(ch))
		} else {
			return nil, fiber.NewError(fiber.StatusBadRequest, "Invalid character")
		}
	}

	if currentNumber.Len() > 0 {
		tokens = append(tokens, currentNumber.String())
	}

	return tokens, nil
}

func parseExpression(tokens []string) (float64, error) {
	pos := 0
	result, newPos, err := parseAddSub(tokens, pos)
	if err != nil {
		return 0, err
	}
	if newPos != len(tokens) {
		return 0, fiber.NewError(fiber.StatusBadRequest, "Invalid expression")
	}
	return result, nil
}

func parseAddSub(tokens []string, pos int) (float64, int, error) {
	left, pos, err := parseMulDiv(tokens, pos)
	if err != nil {
		return 0, pos, err
	}

	for pos < len(tokens) && (tokens[pos] == "+" || tokens[pos] == "-") {
		op := tokens[pos]
		pos++
		right, newPos, err := parseMulDiv(tokens, pos)
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

func parseMulDiv(tokens []string, pos int) (float64, int, error) {
	left, pos, err := parsePrimary(tokens, pos)
	if err != nil {
		return 0, pos, err
	}

	for pos < len(tokens) && (tokens[pos] == "*" || tokens[pos] == "/") {
		op := tokens[pos]
		pos++
		right, newPos, err := parsePrimary(tokens, pos)
		if err != nil {
			return 0, newPos, err
		}
		pos = newPos
		if op == "*" {
			left = left * right
		} else {
			if right == 0 {
				return 0, pos, fiber.NewError(fiber.StatusBadRequest, "Division by zero")
			}
			left = left / right
		}
	}

	return left, pos, nil
}

func parsePrimary(tokens []string, pos int) (float64, int, error) {
	if pos >= len(tokens) {
		return 0, pos, fiber.NewError(fiber.StatusBadRequest, "Unexpected end of expression")
	}

	token := tokens[pos]

	if token == "(" {
		pos++
		result, newPos, err := parseAddSub(tokens, pos)
		if err != nil {
			return 0, newPos, err
		}
		pos = newPos
		if pos >= len(tokens) || tokens[pos] != ")" {
			return 0, pos, fiber.NewError(fiber.StatusBadRequest, "Missing closing parenthesis")
		}
		pos++
		return result, pos, nil
	}

	if token == "-" {
		pos++
		val, newPos, err := parsePrimary(tokens, pos)
		if err != nil {
			return 0, newPos, err
		}
		return -val, newPos, nil
	}

	if token == "+" {
		pos++
		return parsePrimary(tokens, pos)
	}

	num, err := strconv.ParseFloat(token, 64)
	if err != nil {
		return 0, pos, fiber.NewError(fiber.StatusBadRequest, "Invalid number")
	}
	pos++
	return num, pos, nil
}