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

	// Create tables if they don't exist
	createCartsTable := `
	CREATE TABLE IF NOT EXISTS carts (
		cart_id TEXT PRIMARY KEY,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	createCartItemsTable := `
	CREATE TABLE IF NOT EXISTS cart_items (
		cart_id TEXT,
		item_id INTEGER,
		count INTEGER,
		PRIMARY KEY (cart_id, item_id),
		FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE
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
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create cart",
		})
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

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate required fields
	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cart_id is required",
		})
	}

	// Check if cart exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	if exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Cart not found",
		})
	}

	// Start transaction for atomic operation
	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to start transaction",
		})
	}
	defer tx.Rollback()

	// Check if item already exists in cart
	var currentCount int
	err = tx.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?",
		req.CartID, req.ItemID).Scan(&currentCount)

	if err == sql.ErrNoRows {
		// Item doesn't exist in cart
		if req.Count > 0 {
			// Add new item
			_, err = tx.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)",
				req.CartID, req.ItemID, req.Count)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to add item to cart",
				})
			}
		}
		// If count is negative or zero for non-existent item, do nothing
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	} else {
		// Item exists, update count
		newCount := currentCount + req.Count
		if newCount <= 0 {
			// Remove item if count becomes zero or negative
			_, err = tx.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?",
				req.CartID, req.ItemID)
		} else {
			// Update count
			_, err = tx.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?",
				newCount, req.CartID, req.ItemID)
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to update cart",
			})
		}
	}

	if err = tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to commit transaction",
		})
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate required fields
	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cart_id is required",
		})
	}

	// Check if cart exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	if exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Cart not found",
		})
	}

	// Get items
	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id", req.CartID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve cart items",
		})
	}
	defer rows.Close()

	items := []CartItem{}
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to scan cart items",
			})
		}
		items = append(items, item)
	}

	if err = rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Error iterating over rows",
		})
	}

	return c.JSON(fiber.Map{
		"items": items,
	})
}

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	// Create fiber app
	app := fiber.New()

	// Routes
	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}