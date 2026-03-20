<CODE>
package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createCartsTable := `
	CREATE TABLE IF NOT EXISTS carts (
		cart_id TEXT PRIMARY KEY
	);`

	createCartItemsTable := `
	CREATE TABLE IF NOT EXISTS cart_items (
		cart_id TEXT NOT NULL,
		item_id INTEGER NOT NULL,
		count INTEGER NOT NULL,
		PRIMARY KEY (cart_id, item_id),
		FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
	);`

	_, err = db.Exec(createCartsTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createCartItemsTable)
	if err != nil {
		return err
	}

	return nil
}

func createCart(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	_, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create cart"})
	}

	return c.Status(201).JSON(fiber.Map{"cart_id": cartID})
}

func addToCart(c *fiber.Ctx) error {
	var req struct {
		CartID string `json:"cart_id"`
		ItemID int    `json:"item_id"`
		Count  int    `json:"count"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.CartID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "cart_id is required"})
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
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to remove item"})
		}
	} else {
		_, err = db.Exec(`
			INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)
			ON CONFLICT(cart_id, item_id) DO UPDATE SET count = ?`,
			req.CartID, req.ItemID, newCount, newCount)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to update cart"})
		}
	}

	return c.SendStatus(200)
}

func retrieveCart(c *fiber.Ctx) error {
	var req struct {
		CartID string `json:"cart_id"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.CartID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "cart_id is required"})
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
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve cart"})
	}
	defer rows.Close()

	items := []fiber.Map{}
	for rows.Next() {
		var itemID, count int
		if err := rows.Scan(&itemID, &count); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to parse cart items"})
		}
		items = append(items, fiber.Map{
			"item_id": itemID,
			"count":   count,
		})
	}

	return c.JSON(fiber.Map{"items": items})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>