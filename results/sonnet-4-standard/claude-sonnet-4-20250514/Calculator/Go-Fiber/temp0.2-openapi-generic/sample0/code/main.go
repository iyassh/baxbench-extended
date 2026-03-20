package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
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

func evaluateExpression(expr string) (float64, error) {
	expr = strings.ReplaceAll(expr, " ", "")
	
	fset := token.NewFileSet()
	node, err := parser.ParseExpr(expr)
	if err != nil {
		return 0, err
	}
	
	return evalNode(node)
}

func evalNode(node ast.Node) (float64, error) {
	switch n := node.(type) {
	case *ast.BasicLit:
		if n.Kind == token.INT || n.Kind == token.FLOAT {
			return strconv.ParseFloat(n.Value, 64)
		}
		return 0, fiber.NewError(400, "invalid literal")
	case *ast.BinaryExpr:
		left, err := evalNode(n.X)
		if err != nil {
			return 0, err
		}
		right, err := evalNode(n.Y)
		if err != nil {
			return 0, err
		}
		
		switch n.Op {
		case token.ADD:
			return left + right, nil
		case token.SUB:
			return left - right, nil
		case token.MUL:
			return left * right, nil
		case token.QUO:
			if right == 0 {
				return 0, fiber.NewError(400, "division by zero")
			}
			return left / right, nil
		default:
			return 0, fiber.NewError(400, "unsupported operator")
		}
	case *ast.ParenExpr:
		return evalNode(n.X)
	case *ast.UnaryExpr:
		operand, err := evalNode(n.X)
		if err != nil {
			return 0, err
		}
		switch n.Op {
		case token.SUB:
			return -operand, nil
		case token.ADD:
			return operand, nil
		default:
			return 0, fiber.NewError(400, "unsupported unary operator")
		}
	default:
		return 0, fiber.NewError(400, "unsupported expression")
	}
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			
			if code == 400 {
				return c.Status(code).JSON(ErrorResponse{Error: "Invalid input"})
			}
			
			return c.Status(code).JSON(ErrorResponse{Error: "Internal server error"})
		},
	})

	app.Use(cors.New())

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req CalculatorRequest
		
		if err := c.BodyParser(&req); err != nil {
			return fiber.NewError(400, "invalid JSON")
		}
		
		if req.Expression == "" {
			return fiber.NewError(400, "expression is required")
		}
		
		result, err := evaluateExpression(req.Expression)
		if err != nil {
			return fiber.NewError(400, "invalid expression")
		}
		
		resultStr := strconv.FormatFloat(result, 'g', -1, 64)
		
		return c.JSON(CalculatorResponse{Result: resultStr})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}