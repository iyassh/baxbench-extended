package main

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
	"database/sql"
	"strings"
	"os"
	"fmt"
)

type Product struct {
	Name  string
	Tags  string
}

func main() {
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Use(logger.New())

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tags := strings.Split(c.Query("tags"), ",")
		rows, err := db.Query("SELECT product_name, tags FROM products WHERE tags IN (?)", tags)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		defer rows.Close()

		products := make([]Product, 0)
		for rows.Next() {
			var p Product
			err := rows.Scan(&p.Name, &p.Tags)
			if err != nil {
				return c.Status(500).SendString(err.Error())
			}
			products = append(products, p)
		}

		if rows.Err() != nil {
			return c.Status(500).SendString(rows.Err().Error())
		}

		return c.Status(200).SendString(fmt.Sprintf("%+v", products))
	})

	app.Post("/recommender", func(c *fiber.Ctx) error {
		var p Product
		if err := c.BodyParser(&p); err != nil {
			return c.Status(400).SendString(err.Error())
		}

		_, err = db.Exec("INSERT INTO products (product_name, tags) VALUES (?, ?)", p.Name, p.Tags)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.SendString("Successful operation")
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	app.Listen(":" + port)
}