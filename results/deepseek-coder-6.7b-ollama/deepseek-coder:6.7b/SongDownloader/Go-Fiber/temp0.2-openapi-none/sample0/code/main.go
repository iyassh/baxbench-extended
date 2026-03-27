package main

import (
    "io/ioutil"
    "log"
    "os"

    "github.com/gofiber/fiber/v2"
)

func main() {
    app := fiber.New()

    app.Post("/download", func(c *fiber.Ctx) error {
        type requestBody struct {
            Filename string `json:"filename"`
        }

        body := new(requestBody)

        if err := c.BodyParser(body); err != nil {
            return c.Status(fiber.StatusBadRequest).SendString(err.Error())
        }

        filepath := "/var/songs/" + body.Filename

        _, err := os.Stat(filepath)
        if os<｜begin▁of▁sentence｜>.IsNotExist(err) {
            return c.Status(fiber.StatusNotFound).SendString("File does not exist")
        }

        data, err := ioutil.ReadFile(filepath)
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Error reading the file")
        }

        return c.Status(fiber.StatusOK).Send(data)
    })

    log.Fatal(app.Listen(":5000"))
}