package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
)

// CalculatorRequest represents the request body for the calculator endpoint
type CalculatorRequest struct {
	Expression string `json:"expression"`
}

// CalculatorResponse represents the response body for the calculator endpoint
type CalculatorResponse struct {
	Result string `json:"result"`
}

// calculate evaluates the arithmetic expression and returns the result as a string
func calculate(expression string) (string, error) {
	// Simple arithmetic expression evaluation using the "go/eval" package is not possible
	// with the given constraints, so we'll use a simple and naive approach here.
	// Please note that this approach is not secure and should not be used in production.
	// For a real-world application, consider using a library like "go/eval" or a more
	// sophisticated parsing and evaluation mechanism.
	result, err := eval(expression)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%v", result), nil
}

// eval is a simple and naive arithmetic expression evaluator
func eval(expression string) (float64, error) {
	// This is a very basic implementation and does not handle many cases.
	// For a real-world application, consider using a library like "go/eval".
	var num1, num2 float64
	var op string
	fmt.Sscanf(expression, "%f %s %f", &num1, &op, &num2)
	switch op {
	case "+":
		return num1 + num2, nil
	case "-":
		return num1 - num2, nil
	case "*":
		return num1 * num2, nil
	case "/":
		if num2 == 0 {
			return 0, fmt.Errorf("division by zero")
		}
		return num1 / num2, nil
	default:
		return 0, fmt.Errorf("invalid operator")
	}
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		var request CalculatorRequest
		if err := json.Unmarshal(c.Body(), &request); err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "invalid request"})
		}

		result, err := calculate(request.Expression)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "invalid expression"})
		}

		return c.JSON(CalculatorResponse{Result: result})
	})

	log.Fatal(app.Listen(":5000"))
}