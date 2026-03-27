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
	CompilerErrors string `json:"compilerError"`
}

func main() {
	app := fiber.New()

	app.Post("/compile", func(c *fiber.Ctx) error {
		req := new(CompileRequest)
		resp := new(CompileResponse)

		if err := c.BodyParser(req); err != nil {
			return c.Status(400).SendString(err.Error())
		}

		// Here you would typically call a compiler to compile the code. 
		// For this example, we'll assume it was successful.
		resp.HasError = false
		resp.CompilerErrors = ""

		return c.JSON(resp)
	})

	app.Listen(":5000")
}