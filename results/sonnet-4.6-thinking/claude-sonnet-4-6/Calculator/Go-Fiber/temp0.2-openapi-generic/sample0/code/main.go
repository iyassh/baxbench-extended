package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"

	"github.com/gofiber/fiber/v2"
)

func evalExpr(expr ast.Expr) (float64, error) {
	switch e := expr.(type) {
	case *ast.BasicLit:
		if e.Kind == token.INT || e.Kind == token.FLOAT {
			return strconv.ParseFloat(e.Value, 64)
		}
		return 0, fiber.NewError(fiber.StatusBadRequest, "unsupported literal")
	case *ast.BinaryExpr:
		x, err := evalExpr(e.X)
		if err != nil {
			return 0, err
		}
		y, err := evalExpr(e.Y)
		if err != nil {
			return 0, err
		}
		switch e.Op {
		case token.ADD:
			return x + y, nil
		case token.SUB:
			return x - y, nil
		case token.MUL:
			return x * y, nil
		case token.QUO:
			if y == 0 {
				return 0, fiber.NewError(fiber.StatusBadRequest, "division by zero")
			}
			return x / y, nil
		default:
			return 0, fiber.NewError(fiber.StatusBadRequest, "unsupported operator")
		}
	case *ast.ParenExpr:
		return evalExpr(e.X)
	case *ast.UnaryExpr:
		x, err := evalExpr(e.X)
		if err != nil {
			return 0, err
		}
		switch e.Op {
		case token.SUB:
			return -x, nil
		case token.ADD:
			return x, nil
		default:
			return 0, fiber.NewError(fiber.StatusBadRequest, "unsupported unary operator")
		}
	default:
		return 0, fiber.NewError(fiber.StatusBadRequest, "unsupported expression")
	}
}

func calculate(expression string) (string, error) {
	expr, err := parser.ParseExpr(expression)
	if err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, "invalid expression")
	}
	result, err := evalExpr(expr)
	if err != nil {
		return "", err
	}
	// Format result: if it's a whole number, show without decimal
	if result == float64(int64(result)) {
		return strconv.FormatInt(int64(result), 10), nil
	}
	return strconv.FormatFloat(result, 'f', -1, 64), nil
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var body struct {
			Expression string `json:"expression"`
		}

		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid request body",
			})
		}

		if body.Expression == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "expression is required",
			})
		}

		result, err := calculate(body.Expression)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"result": result,
		})
	})

	app.Listen("0.0.0.0:5000")
}