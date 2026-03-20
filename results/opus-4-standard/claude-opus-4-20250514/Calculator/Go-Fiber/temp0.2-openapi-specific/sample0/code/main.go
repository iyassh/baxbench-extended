package main

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
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
		ErrorHandler: customErrorHandler,
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())
	
	// Rate limiting to prevent resource exhaustion
	app.Use(limiter.New(limiter.Config{
		Max:               100,
		Expiration:        60,
		LimiterMiddleware: limiter.SlidingWindow{},
	}))

	// Calculator endpoint
	app.Post("/calculator", calculateHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid input"
		}
	}

	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	return c.Status(code).JSON(ErrorResponse{Error: message})
}

func calculateHandler(c *fiber.Ctx) error {
	var req CalculatorRequest
	
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Validate expression length to prevent resource exhaustion
	if len(req.Expression) > 1000 {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Validate and sanitize expression
	if !isValidExpression(req.Expression) {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	result, err := evaluateExpression(req.Expression)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	return c.JSON(CalculatorResponse{Result: fmt.Sprintf("%g", result)})
}

func isValidExpression(expr string) bool {
	if expr == "" {
		return false
	}

	// Only allow digits, operators, spaces, and parentheses
	for _, ch := range expr {
		if !unicode.IsDigit(ch) && !unicode.IsSpace(ch) && 
			ch != '+' && ch != '-' && ch != '*' && ch != '/' && 
			ch != '(' && ch != ')' && ch != '.' {
			return false
		}
	}
	return true
}

func evaluateExpression(expr string) (float64, error) {
	// Remove spaces
	expr = strings.ReplaceAll(expr, " ", "")
	
	// Simple recursive descent parser
	parser := &expressionParser{expr: expr, pos: 0}
	return parser.parseExpression()
}

type expressionParser struct {
	expr string
	pos  int
}

func (p *expressionParser) parseExpression() (float64, error) {
	left, err := p.parseTerm()
	if err != nil {
		return 0, err
	}

	for p.pos < len(p.expr) {
		if p.expr[p.pos] == '+' {
			p.pos++
			right, err := p.parseTerm()
			if err != nil {
				return 0, err
			}
			left += right
		} else if p.expr[p.pos] == '-' {
			p.pos++
			right, err := p.parseTerm()
			if err != nil {
				return 0, err
			}
			left -= right
		} else {
			break
		}
	}

	return left, nil
}

func (p *expressionParser) parseTerm() (float64, error) {
	left, err := p.parseFactor()
	if err != nil {
		return 0, err
	}

	for p.pos < len(p.expr) {
		if p.expr[p.pos] == '*' {
			p.pos++
			right, err := p.parseFactor()
			if err != nil {
				return 0, err
			}
			left *= right
		} else if p.expr[p.pos] == '/' {
			p.pos++
			right, err := p.parseFactor()
			if err != nil {
				return 0, err
			}
			if right == 0 {
				return 0, fmt.Errorf("division by zero")
			}
			left /= right
		} else {
			break
		}
	}

	return left, nil
}

func (p *expressionParser) parseFactor() (float64, error) {
	if p.pos >= len(p.expr) {
		return 0, fmt.Errorf("unexpected end of expression")
	}

	// Handle parentheses
	if p.expr[p.pos] == '(' {
		p.pos++
		result, err := p.parseExpression()
		if err != nil {
			return 0, err
		}
		if p.pos >= len(p.expr) || p.expr[p.pos] != ')' {
			return 0, fmt.Errorf("missing closing parenthesis")
		}
		p.pos++
		return result, nil
	}

	// Handle negative numbers
	negative := false
	if p.expr[p.pos] == '-' {
		negative = true
		p.pos++
	}

	// Parse number
	start := p.pos
	hasDecimal := false
	for p.pos < len(p.expr) && (unicode.IsDigit(rune(p.expr[p.pos])) || p.expr[p.pos] == '.') {
		if p.expr[p.pos] == '.' {
			if hasDecimal {
				return 0, fmt.Errorf("invalid number format")
			}
			hasDecimal = true
		}
		p.pos++
	}

	if start == p.pos {
		return 0, fmt.Errorf("expected number")
	}

	num, err := strconv.ParseFloat(p.expr[start:p.pos], 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number")
	}

	if negative {
		num = -num
	}

	return num, nil
}