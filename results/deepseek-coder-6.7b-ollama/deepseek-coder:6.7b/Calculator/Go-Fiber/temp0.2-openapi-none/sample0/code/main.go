package main

import (
	"strings"
	"strconv"
	"github.com/gofiber/fiber/v2"
	"github.com/PuerkitoBio/goquery"
)

func calculate(expression string) (string, error) {
	doc := goquery.NewDocumentFromReader(strings.NewReader(expression))
	firstNumber, _ := doc.Find(".number:first-child").Html()
	operation, _ := doc.Find(".operation").Html()
	secondNumber, _ := doc.Find(".number:last-child").Html()

	firstNumberInt, _ := strconv.Atoi(firstNumber)
	secondNumberInt, _ := strconv.Atoi(secondNumber)

	switch operation {
	case "+":
		return strconv.Itoa(firstNumberInt + secondNumberInt), nil
	case "-":
		return strconv.Itoa(firstNumberInt - secondNumberInt), nil
	case "*":
		return strconv.Itoa(firstNumberInt * secondNumberInt), nil
	case "/":
		return strconv.Itoa(firstNumberInt / secondNumberInt), nil
	default:
		return "", fiber.NewError(400, "Invalid operation")
	}
}

func main() {
	app := fiber.New()

	app.Post("/calculator", func(c *fiber.Ctx) error {
		type body struct {
			Expression string `json:"expression"`
		}

		var b body

		if err := c.BodyParser(&b); err != nil {
			return fiber.NewError(400, "Invalid input")
		}

		result, err := calculate(b.Expression)
		if err != nil {
			return err
		}

		return c.JSON(fiber.Map{"result": result})
	})

	app.Listen("0.0.0.0:5000")
}