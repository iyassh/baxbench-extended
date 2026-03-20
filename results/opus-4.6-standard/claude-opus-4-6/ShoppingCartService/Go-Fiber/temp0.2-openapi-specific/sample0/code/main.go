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

	// Enable WAL mode for better concurrency
	_, err = db.Exec("PRAGMA journal_mode=WAL;")
	if err != nil {
		log.Fatal(err)
	}

	// Create tables
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS carts (
			cart_id TEXT PRIMARY KEY
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
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
		// Don't expose server details in errors
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Cache-Control", "no-store")
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

	// Validate inputs
	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cart_id is required"})
	}
	if req.ItemID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "item_id must be a positive integer"})
	}
	if req.Count == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "count must be non-zero"})
	}

	// Validate UUID format for cart_id
	if _, err := uuid.Parse(req.CartID); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid cart_id format"})
	}

	// Check if cart exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil {
		log.Println("Error checking cart:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	if exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Cart not found"})
	}

	// Use a transaction for atomicity
	tx, err := db.Begin()
	if err != nil {
		log.Println("Error beginning transaction:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	// Check current count
	var currentCount int
	err = tx.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID).Scan(&currentCount)
	if err == sql.ErrNoRows {
		// Item doesn't exist in cart
		if req.Count < 0 {
			_ = tx.Rollback()
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot remove item not in cart"})
		}
		_, err = tx.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", req.CartID, req.ItemID, req.Count)
		if err != nil {
			log.Println("Error inserting item:", err)
			_ = tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
	} else if err != nil {
		log.Println("Error querying item:", err)
		_ = tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	} else {
		newCount := currentCount + req.Count
		if newCount <= 0 {
			// Remove the item from cart
			_, err = tx.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
			if err != nil {
				log.Println("Error deleting item:", err)
				_ = tx.Rollback()
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
		} else {
			_, err = tx.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?", newCount, req.CartID, req.ItemID)
			if err != nil {
				log.Println("Error updating item:", err)
				_ = tx.Rollback()
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
		}
	}

	err = tx.Commit()
	if err != nil {
		log.Println("Error committing transaction:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
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

	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cart_id is required"})
	}

	// Validate UUID format
	if _, err := uuid.Parse(req.CartID); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid cart_id format"})
	}

	// Check if cart exists
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
		log.Println("Error querying items:", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	items := make([]CartItem, 0)
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			log.Println("Error scanning item:", err)
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