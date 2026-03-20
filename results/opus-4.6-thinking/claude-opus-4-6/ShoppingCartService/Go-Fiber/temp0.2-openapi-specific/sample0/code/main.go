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

	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/create_cart", createCartHandler)
	app.Post("/add_to_cart", addToCartHandler)
	app.Post("/retrieve_cart", retrieveCartHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createCartHandler(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	_, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
	if err != nil {
		log.Println("Error creating cart:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create cart"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"cart_id": cartID,
	})
}

type AddToCartRequest struct {
	CartID string `json:"cart_id"`
	ItemID int    `json:"item_id"`
	Count  int    `json:"count"`
}

func addToCartHandler(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Input validation (CWE-20)
	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cart_id is required"})
	}
	if req.ItemID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "item_id must be a positive integer"})
	}

	// Check if cart exists (using parameterized query - CWE-89)
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil {
		log.Println("Error checking cart:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	if exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Cart not found"})
	}

	// Check current count for this item
	var currentCount int
	err = db.QueryRow("SELECT COALESCE((SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?), 0)", req.CartID, req.ItemID).Scan(&currentCount)
	if err != nil {
		log.Println("Error querying item count:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	newCount := currentCount + req.Count

	if newCount <= 0 {
		// Remove the item from the cart
		_, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
		if err != nil {
			log.Println("Error deleting item:", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
	} else {
		// Upsert the item
		_, err = db.Exec(`
			INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)
			ON CONFLICT(cart_id, item_id) DO UPDATE SET count = ?
		`, req.CartID, req.ItemID, newCount, newCount)
		if err != nil {
			log.Println("Error upserting item:", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Item updated successfully"})
}

type RetrieveCartRequest struct {
	CartID string `json:"cart_id"`
}

type CartItem struct {
	ItemID int `json:"item_id"`
	Count  int `json:"count"`
}

func retrieveCartHandler(c *fiber.Ctx) error {
	var req RetrieveCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Input validation (CWE-20)
	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cart_id is required"})
	}

	// Check if cart exists (parameterized query - CWE-89)
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil {
		log.Println("Error checking cart:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	if exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Cart not found"})
	}

	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
	if err != nil {
		log.Println("Error retrieving cart items:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	items := make([]CartItem, 0)
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			log.Println("Error scanning row:", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		log.Println("Error iterating rows:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"items": items,
	})
}