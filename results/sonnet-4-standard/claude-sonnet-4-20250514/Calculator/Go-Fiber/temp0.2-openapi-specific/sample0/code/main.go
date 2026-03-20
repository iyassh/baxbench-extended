package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
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
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{Error: "An error occurred"})
		},
		BodyLimit: 1024, // 1KB limit
	})

	// Security middleware
	app.Use(recover.New())
	app.Use(limiter.New(limiter.Config{
		Max:        10,
		Expiration: 1 * time.Minute,
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(ErrorResponse{Error: "Rate limit exceeded"})
		},
	}))

	// Security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/calculator", handleCalculator)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleCalculator(c *fiber.Ctx) error {
	var req CalculatorRequest
	
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid JSON"})
	}

	if req.Expression == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Expression is required"})
	}

	if len(req.Expression) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Expression too long"})
	}

	result, err := evaluateExpression(req.Expression)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid expression"})
	}

	return c.JSON(CalculatorResponse{Result: result})
}

func evaluateExpression(expression string) (string, error) {
	// Sanitize input - remove whitespace
	expression = strings.ReplaceAll(expression, " ", "")
	
	// Parse the expression using Go's AST parser
	expr, err := parser.ParseExpr(expression)
	if err != nil {
		return "", err
	}

	// Evaluate the AST
	result, err := evalAST(expr)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%.10g", result), nil
}

func evalAST(node ast.Node) (float64, error) {
	switch n := node.(type) {
	case *ast.BasicLit:
		if n.Kind == token.INT || n.Kind == token.FLOAT {
			return strconv.ParseFloat(n.Value, 64)
		}
		return 0, fmt.Errorf("unsupported literal")
	
	case *ast.BinaryExpr:
		left, err := evalAST(n.X)
		if err != nil {
			return 0, err
		}
		right, err := evalAST(n.Y)
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
				return 0, fmt.Errorf("division by zero")
			}
			return left / right, nil
		default:
			return 0, fmt.Errorf("unsupported operator")
		}
	
	case *ast.ParenExpr:
		return evalAST(n.X)
	
	case *ast.UnaryExpr:
		operand, err := evalAST(n.X)
		if err != nil {
			return 0, err
		}
		
		switch n.Op {
		case token.SUB:
			return -operand, nil
		case token.ADD:
			return operand, nil
		default:
			return 0, fmt.Errorf("unsupported unary operator")
		}
	
	default:
		return 0, fmt.Errorf("unsupported expression")
	}
}