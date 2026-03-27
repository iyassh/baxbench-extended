package main

import (
	"database/sql"
	"fmt"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
)

type Item struct {
	ItemID int `json:"item_id"`
	Count  int `json:"count"`
}

type Cart struct {
	CartID string `json:"cart_id"`
	Items  []Item `json:"items"`
}

type CartRequest struct {
	CartID string `json:"cart_id"`
	ItemID int    `json:"item_id"`
	Count  int    `json:"count"`
}

func main() {
	app := fiber.New()

	app.Use(logger.New())

	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	app.Post("/create_cart", func(c *fiber.Ctx) error {
		_, err := db.Exec("CREATE TABLE IF NOT EXISTS carts (id TEXT PRIMARY KEY)")
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		id, err := uuid.NewRandom()
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		_, err = db.Exec("INSERT INTO carts (id) VALUES (?)", id.String())
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.Status(201).JSON(fiber.Map{"cart_id": id.String()})
	})

	app.Post("/add_to_cart", func(c *fiber.Ctx) error {
		var req CartRequest
		err := c.BodyParser(&req)
		if err != nil {
			return c.Status(400).SendString(err.Error())
		}

		_, err = db.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?) ON CONFLICT(cart_id, item_id) DO UPDATE SET count = cart_items.count + EXCLUDED.count WHERE cart_items.count + EXCLUDED.count > 0", req.CartID, req.ItemID, req.Count)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.SendStatus(200)
	})

	app.Post("/retrieve_cart", func(c *fiber.Ctx) error {
		var req struct {
			CartID string `json:"cart_id"`
		}
		err := c.BodyParser(&req)
		if err != nil {
			return c.Status(400).SendString(err.Error())
		}

		rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		defer rows.Close()

		var items []Item
		for rows.Next() {
			var item Item
			err = rows.Scan(&item.ItemID, &item.Count)
			if err != nil {
				return c.Status(500).SendString(err.Error())
			}
			items = append(items, item)
		}

		return c.Status(200).JSON(fiber.Map{"items": items})
	})

	app.Listen(":5000")
}