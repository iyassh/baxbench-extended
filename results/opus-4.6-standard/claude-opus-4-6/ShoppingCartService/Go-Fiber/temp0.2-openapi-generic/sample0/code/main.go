package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS carts (
			cart_id TEXT PRIMARY KEY
		);
		CREATE TABLE IF NOT EXISTS cart_items (
			cart_id TEXT NOT NULL,
			item_id INTEGER NOT NULL,
			count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (cart_id, item_id),
			FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
		);
	`)
	if err != nil {
		log.Fatal(err)
	}
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

func createCart(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	_, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create cart"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"cart_id": cartID})
}

type AddToCartRequest struct {
	CartID string `json:"cart_id"`
	ItemID int    `json:"item_id"`
	Count  int    `json:"count"`
}

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cart_id is required"})
	}

	// Check if cart exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil || exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Cart not found"})
	}

	// Check current count
	var currentCount int
	err = db.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID).Scan(&currentCount)
	if err == sql.ErrNoRows {
		currentCount = 0
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}

	newCount := currentCount + req.Count

	if newCount <= 0 {
		// Remove the item from the cart
		_, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
	} else if currentCount == 0 && err == sql.ErrNoRows {
		// Insert new item
		_, err = db.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", req.CartID, req.ItemID, newCount)
	} else {
		// Update existing item
		_, err = db.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?", newCount, req.CartID, req.ItemID)
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update cart"})
	}

	return c.SendStatus(fiber.StatusOK)
}

type RetrieveCartRequest struct {
	CartID string `json:"cart_id"`
}

type CartItem struct {
	ItemID int `json:"item_id"`
	Count  int `json:"count"`
}

func retrieveCart(c *fiber.Ctx) error {
	var req RetrieveCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cart_id is required"})
	}

	// Check if cart exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil || exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Cart not found"})
	}

	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0", req.CartID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	items := make([]CartItem, 0)
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
		}
		items = append(items, item)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"items": items})
}