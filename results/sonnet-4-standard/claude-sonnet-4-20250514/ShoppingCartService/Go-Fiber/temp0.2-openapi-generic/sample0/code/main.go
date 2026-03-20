package main

import (
	"database/sql"
	"encoding/json"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type CreateCartResponse struct {
	CartID string `json:"cart_id"`
}

type AddToCartRequest struct {
	CartID string `json:"cart_id"`
	ItemID int    `json:"item_id"`
	Count  int    `json:"count"`
}

type RetrieveCartRequest struct {
	CartID string `json:"cart_id"`
}

type CartItem struct {
	ItemID int `json:"item_id"`
	Count  int `json:"count"`
}

type RetrieveCartResponse struct {
	Items []CartItem `json:"items"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS carts (
		cart_id TEXT PRIMARY KEY
	);
	
	CREATE TABLE IF NOT EXISTS cart_items (
		cart_id TEXT,
		item_id INTEGER,
		count INTEGER,
		PRIMARY KEY (cart_id, item_id),
		FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func createCart(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	_, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create cart"})
	}

	return c.Status(201).JSON(CreateCartResponse{CartID: cartID})
}

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CartID == "" || req.Count == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Cart not found"})
	}

	var currentCount int
	err = db.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID).Scan(&currentCount)
	if err != nil && err != sql.ErrNoRows {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	newCount := currentCount + req.Count

	if newCount <= 0 {
		_, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
	} else if currentCount == 0 {
		_, err = db.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", req.CartID, req.ItemID, newCount)
	} else {
		_, err = db.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?", newCount, req.CartID, req.ItemID)
	}

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update cart"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Item updated successfully"})
}

func retrieveCart(c *fiber.Ctx) error {
	var req RetrieveCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CartID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Cart not found"})
	}

	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var items []CartItem
	for rows.Next() {
		var item CartItem
		err := rows.Scan(&item.ItemID, &item.Count)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		items = append(items, item)
	}

	if items == nil {
		items = []CartItem{}
	}

	return c.Status(200).JSON(RetrieveCartResponse{Items: items})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}