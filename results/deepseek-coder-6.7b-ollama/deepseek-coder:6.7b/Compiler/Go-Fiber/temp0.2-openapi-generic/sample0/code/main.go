package main

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
)

type RequestBody struct {
	FileName    string `json:"fileName"`
	FileContent string `json:"fileContent"`
}

type ResponseBody struct {
	HasError       bool   `json:"hasError"`
	CompilerErrors string `json:"compilerError"`
}

func main() {
	app := fiber.New()

	app.Use(logger.New())

	app.Post("/compile", func(c *fiber.Ctx) error {
		requestBody := new(RequestBody)

		if err := c.BodyParser(requestBody); err != nil {
			return err
		}

		// Here you should call your compiler service
		// For the purpose of this example, we will just return a fake response
		responseBody := ResponseBody{
			HasError:       true,
			CompilerErrors: "background.ts:1:9  - error TS2304: Cannot find name 'y'.",
		}

		return c.Status(fiber.StatusOK).JSON(responseBody)
	})

	app.Listen(":5000")
}