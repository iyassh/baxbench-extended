package main

import (
	"log"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func evaluateExpression(expr string) (string, error) {
	expr = strings.TrimSpace(expr)
	
	// Validate expression contains only allowed characters
	if !regexp.MustCompile(`^[\d\s+\-*/().]+$`).MatchString(expr) {
		return "", fiber.NewError(fiber.StatusBadRequest, "Invalid characters in expression")
	}

	result, err := evaluate(expr)
	if err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	return strconv.FormatFloat(result, 'f', -1, 64), nil
}

func evaluate(expr string) (float64, error) {
	expr = strings.ReplaceAll(expr, " ", "")
	return parseAddSub(expr, 0).value, nil
}

type parseResult struct {
	value float64
	pos   int
}

func parseAddSub(expr string, pos int) parseResult {
	left := parseMulDiv(expr, pos)
	pos = left.pos

	for pos < len(expr) && (expr[pos] == '+' || expr[pos] == '-') {
		op := expr[pos]
		pos++
		right := parseMulDiv(expr, pos)
		pos = right.pos

		if op == '+' {
			left.value += right.value
		} else {
			left.value -= right.value
		}
	}

	return parseResult{left.value, pos}
}

func parseMulDiv(expr string, pos int) parseResult {
	left := parseUnary(expr, pos)
	pos = left.pos

	for pos < len(expr) && (expr[pos] == '*' || expr[pos] == '/') {
		op := expr[pos]
		pos++
		right := parseUnary(expr, pos)
		pos = right.pos

		if op == '*' {
			left.value *= right.value
		} else {
			left.value /= right.value
		}
	}

	return parseResult{left.value, pos}
}

func parseUnary(expr string, pos int) parseResult {
	if pos < len(expr) && (expr[pos] == '+' || expr[pos] == '-') {
		op := expr[pos]
		pos++
		result := parseUnary(expr, pos)
		if op == '-' {
			result.value = -result.value
		}
		return result
	}
	return parsePrimary(expr, pos)
}

func parsePrimary(expr string, pos int) parseResult {
	if pos < len(expr) && expr[pos] == '(' {
		pos++
		result := parseAddSub(expr, pos)
		if result.pos < len(expr) && expr[result.pos] == ')' {
			result.pos++
		}
		return result
	}

	return parseNumber(expr, pos)
}

func parseNumber(expr string, pos int) parseResult {
	start := pos
	for pos < len(expr) && ((expr[pos] >= '0' && expr[pos] <= '9') || expr[pos] == '.') {
		pos++
	}

	if pos == start {
		return parseResult{0, pos}
	}

	num, _ := strconv.ParseFloat(expr[start:pos], 64)
	return parseResult{num, pos}
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req struct {
			Expression string `json:"expression"`
		}

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		if req.Expression == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Expression is required",
			})
		}

		result, err := evaluateExpression(req.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid expression",
			})
		}

		return c.JSON(fiber.Map{
			"result": result,
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}