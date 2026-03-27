package main

import (
	"database/sql"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
	"strconv"
)

type Item struct {
	ItemId int `json:"item_id"`
	Count  int `json:"count"`
}

type Cart struct {
	CartId string `json:"cart_id"`
	Items  []Item `json:"items"`
}

var db *sql.DB

func main() {
	db, _ = sql.Open("sqlite3", "db.sqlite3")
	db.Exec(`
		CREATE TABLE IF NOT EXISTS carts (
			id TEXT PRIMARY KEY,
			items TEXT
		)
	`)

	app := fiber.New()
	app.Use(logger.New())

	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	app.Listen(":5000")
}

func createCart(c *fiber.Ctx) error {
	cartId := c.FormValue("cart_id")
	_, err := db.Exec("INSERT INTO carts (id, items) VALUES (?, '{}')", cartId)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	return c.Status(201).JSON(fiber.Map{"cart_id": cartId})
}

func addToCart(c *fiber.Ctx) error {
	cartId := c.FormValue("cart_id")
	itemId := c.FormValue("item_id")
	count := c.FormValue("count")

	_, err := db.Exec(`
		UPDATE carts 
		SET items = json_insert(
			json_insert(
				json_insert(
					json(items), 
					'$.` + itemId + `', 
					` + count + `
				), 
				'$.item_id', 
				` + itemId + `
			), 
			'$.count', 
			` + count + `
		)
		WHERE id = ?
	`, cartId)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	return c.SendStatus(200)
}

func retrieveCart(c *fiber.Ctx) error {
	cartId := c.FormValue("cart_id")
	row := db.QueryRow("SELECT items FROM carts WHERE id = ?", cartId)
	var items string
	err := row.Scan(&items)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	var cart Cart
	json.Unmarshal([]byte(items), &cart.Items)
	cart.CartId = cartId

	return c.Status(200).JSON(cart)
}