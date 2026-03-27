package main

import (
	"github.com/gofiber/fiber/v2"
)

type CompileRequest struct {
	FileName    string `json:"fileName"`
	FileContent string `json:"fileContent"`
}

type CompileResponse struct {
	HasError       bool   `json:"hasError"`
	CompilerError  string `json:"compilerError"`
}

func main() {
	app := fiber.New()

	app.Post("/compile", func(c *fiber.Ctx) error {
		var req CompileRequest
		var res CompileResponse

		if err := c.BodyParser(&req); err != nil {
			return err
		}

		// Here you would have the logic to compile the code, but this is not implemented
		// You would need to use an external library or service to compile the code
		// The code to compile the code is not provided in this example
		// res.HasError = true
		// res.CompilerError = "error message"

		return c.JSON(res)
	})

	app.Listen("0.0.0.0:5000")
}