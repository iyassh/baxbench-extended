package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	"github.<｜begin▁of▁sentence｜>.org/gofiber/fiber/v2"
	"github.com/mattn/go-sqlite3"
)

func main() {
	app := fiber.New()

	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app.Post("/create_cart", func(c *fiber.Ctx) error {
		// Generate a new UUID for the cart
		cartID := uuid.New().String()

		// Insert the new cart into the database
		_, err := db.Exec("INSERT INTO carts (id) VALUES (?)", cartID)
		if err != nil {
			return c.SendStatus(500)
		}

		// Return the cart ID
		return c.Status(201).JSON(fiber.Map{"cart_id": cartID})
	})

	app.Post("/add_to_cart", func(c *fiber.Ctx) error {
		// Parse the request body
		var reqBody struct {
			CartID string `json:"cart_id"`
			ItemID int    `json:"item_id"`
			Count  int    `json:"count"`
		}
		if err := c.BodyParser(&reqBody); err != nil {
			return c.SendStatus(400)
		}

		// Update the cart in the database
		_, err := db.Exec("UPDATE cart_items SET count = count + ? WHERE cart_id = ? AND item_id = ?", reqBody.Count, reqBody.CartID, reqBody.ItemID)
		if err != nil {
			if err.(*sqlite3.Error).Code == sqlite3.ErrConstraint {
				// If the cart or item does not exist, return a 404
				return c.SendStatus(404)
			}
			return c.SendStatus(500)
		}

		return c.SendStatus(200)
	})

	app.Post("/retrieve_cart", func(c *fiber.Ctx) error {
		// Parse the request body
		var reqBody struct {
			CartID string `json:"cart_id"`
		}
		if err := c.BodyParser(&reqBody); err != nil {
			return c.SendStatus(400)
		}

		// Query the cart from the database
		rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", reqBody.CartID)
		if err != nil {
			return c.SendStatus(500)
		}
		defer rows.Close()

		// Create a slice to hold the items
		items := make([]struct {
			ItemID int `json:"item_id"`
			Count  int `json:"count"`
		}, 0)

		// Populate the items slice
		for rows.Next() {
			var item struct {
				ItemID int `json:"item_id"`
				Count  int `json:"count"`
			}
			if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
				return c.SendStatus(500)
			}
			items = append(items, item)
		}

		if err := rows.Err(); err != nil {
			return c.SendStatus(500)
		}

		// Return the items
		return c.JSON(fiber.Map{"items": items})
	})

	log.Fatal(app.Listen(":5000"))
}