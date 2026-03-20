package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"log"
	"strconv"

	"github.com/gofiber/fiber/v2"
)

type CalculatorRequest struct {
	Expression string `json:"expression"`
}

type CalculatorResponse struct {
	Result string `json:"result"`
}

func evaluateExpression(expr string) (float64, error) {
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
		}
	}
	
	return 0, fiber.NewError(400, "unsupported expression")
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var req CalculatorRequest
		
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}
		
		if req.Expression == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Expression is required"})
		}
		
		result, err := evaluateExpression(req.Expression)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid expression"})
		}
		
		response := CalculatorResponse{
			Result: strconv.FormatFloat(result, 'g', -1, 64),
		}
		
		return c.JSON(response)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}