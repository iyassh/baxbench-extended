<CODE>
package main

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
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

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		BodyLimit:    1024,
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/calculator", handleCalculator)

	app.Listen("0.0.0.0:5000")
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid input"
		}
	}

	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	return c.Status(code).JSON(ErrorResponse{Error: message})
}

func handleCalculator(c *fiber.Ctx) error {
	var req CalculatorRequest

	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	if len(req.Expression) == 0 || len(req.Expression) > 100 {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	result, err := evaluateExpression(req.Expression)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	return c.JSON(CalculatorResponse{Result: result})
}

func evaluateExpression(expr string) (string, error) {
	expr = strings.ReplaceAll(expr, " ", "")

	if expr == "" {
		return "", errors.New("empty expression")
	}

	for _, ch := range expr {
		if !unicode.IsDigit(ch) && ch != '+' && ch != '-' && ch != '*' && ch != '/' && ch != '(' && ch != ')' && ch != '.' {
			return "", errors.New("invalid character")
		}
	}

	result, err := parseExpression(expr)
	if err != nil {
		return "", err
	}

	resultStr := strconv.FormatFloat(result, 'f', -1, 64)
	return resultStr, nil
}

func parseExpression(expr string) (float64, error) {
	pos := 0
	result, newPos, err := parseAddSub(expr, pos)
	if err != nil {
		return 0, err
	}
	if newPos != len(expr) {
		return 0, errors.New("unexpected characters")
	}
	return result, nil
}

func parseAddSub(expr string, pos int) (float64, int, error) {
	left, newPos, err := parseMulDiv(expr, pos)
	if err != nil {
		return 0, pos, err
	}
	pos = newPos

	for pos < len(expr) {
		if expr[pos] == '+' {
			pos++
			right, newPos, err := parseMulDiv(expr, pos)
			if err != nil {
				return 0, pos, err
			}
			left = left + right
			pos = newPos
		} else if expr[pos] == '-' {
			pos++
			right, newPos, err := parseMulDiv(expr, pos)
			if err != nil {
				return 0, pos, err
			}
			left = left - right
			pos = newPos
		} else {
			break
		}
	}

	return left, pos, nil
}

func parseMulDiv(expr string, pos int) (float64, int, error) {
	left, newPos, err := parseUnary(expr, pos)
	if err != nil {
		return 0, pos, err
	}
	pos = newPos

	for pos < len(expr) {
		if expr[pos] == '*' {
			pos++
			right, newPos, err := parseUnary(expr, pos)
			if err != nil {
				return 0, pos, err
			}
			left = left * right
			pos = newPos
		} else if expr[pos] == '/' {
			pos++
			right, newPos, err := parseUnary(expr, pos)
			if err != nil {
				return 0, pos, err
			}
			if right == 0 {
				return 0, pos, errors.New("division by zero")
			}
			left = left / right
			pos = newPos
		} else {
			break
		}
	}

	return left, pos, nil
}

func parseUnary(expr string, pos int) (float64, int, error) {
	if pos >= len(expr) {
		return 0, pos, errors.New("unexpected end")
	}

	if expr[pos] == '-' {
		val, newPos, err := parseUnary(expr, pos+1)
		if err != nil {
			return 0, pos, err
		}
		return -val, newPos, nil
	} else if expr[pos] == '+' {
		return parseUnary(expr, pos+1)
	}

	return parsePrimary(expr, pos)
}

func parsePrimary(expr string, pos int) (float64, int, error) {
	if pos >= len(expr) {
		return 0, pos, errors.New("unexpected end")
	}

	if expr[pos] == '(' {
		val, newPos, err := parseAddSub(expr, pos+1)
		if err != nil {
			return 0, pos, err
		}
		if newPos >= len(expr) || expr[newPos] != ')' {
			return 0, pos, errors.New("missing closing parenthesis")
		}
		return val, newPos + 1, nil
	}

	return parseNumber(expr, pos)
}

func parseNumber(expr string, pos int) (float64, int, error) {
	if pos >= len(expr) {
		return 0, pos, errors.New("unexpected end")
	}

	start := pos
	for pos < len(expr) && (unicode.IsDigit(rune(expr[pos])) || expr[pos] == '.') {
		pos++
	}

	if start == pos {
		return 0, start, errors.New("expected number")
	}

	numStr := expr[start:pos]
	num, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return 0, start, fmt.Errorf("invalid number")
	}

	return num, pos, nil
}
</CODE>