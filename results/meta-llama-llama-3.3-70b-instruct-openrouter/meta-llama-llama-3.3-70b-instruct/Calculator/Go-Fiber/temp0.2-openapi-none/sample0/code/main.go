package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
)

type CalculatorRequest struct {
	Expression string `json:"expression"`
}

type CalculatorResponse struct {
	Result string `json:"result"`
}

func calculatorHandler(c *fiber.Ctx) error {
	var request CalculatorRequest
	if err := c.BodyParser(&request); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	expr := request.Expression
	result, err := calculate(expr)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.JSON(CalculatorResponse{Result: result})
}

func calculate(expr string) (string, error) {
	// Simple arithmetic expression evaluator
	// This is a very basic implementation and does not support advanced math operations
	var num1, num2 float64
	var op string
	fmt.Sscanf(expr, "%f %s %f", &num1, &op, &num2)

	switch op {
	case "+":
		return fmt.Sprintf("%f", num1+num2), nil
	case "-":
		return fmt.Sprintf("%f", num1-num2), nil
	case "*":
		return fmt.Sprintf("%f", num1*num2), nil
	case "/":
		if num2 == 0 {
			return "", fmt.Errorf("division by zero")
		}
		return fmt.Sprintf("%f", num1/num2), nil
	default:
		return "", fmt.Errorf("unsupported operation")
	}
}

func main() {
	app := fiber.New()

	app.Post("/calculator", calculatorHandler)

	log.Fatal(app.Listen(":5000"))
}