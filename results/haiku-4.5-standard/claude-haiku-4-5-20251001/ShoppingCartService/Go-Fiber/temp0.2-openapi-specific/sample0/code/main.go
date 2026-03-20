package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type CartItem struct {
	ItemID int `json:"item_id"`
	Count  int `json:"count"`
}

type CartResponse struct {
	Items []CartItem `json:"items"`
}

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

var (
	db *sql.DB
	mu sync.RWMutex
)

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	err = db.Ping()
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS carts (
		cart_id TEXT PRIMARY KEY,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	
	CREATE TABLE IF NOT EXISTS cart_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		cart_id TEXT NOT NULL,
		item_id INTEGER NOT NULL,
		count INTEGER NOT NULL,
		FOREIGN KEY (cart_id) REFERENCES carts(cart_id),
		UNIQUE(cart_id, item_id)
	);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

func createCart(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	mu.Lock()
	defer mu.Unlock()

	_, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create cart"})
	}

	return c.Status(http.StatusCreated).JSON(CreateCartResponse{CartID: cartID})
}

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CartID == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "cart_id is required"})
	}

	if req.ItemID < 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "item_id must be non-negative"})
	}

	mu.Lock()
	defer mu.Unlock()

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}

	if !exists {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{"error": "Cart not found"})
	}

	var currentCount int
	err = db.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID).Scan(&currentCount)

	if err == sql.ErrNoRows {
		if req.Count > 0 {
			_, err = db.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", req.CartID, req.ItemID, req.Count)
			if err != nil {
				return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to add item"})
			}
		}
	} else if err == nil {
		newCount := currentCount + req.Count
		if newCount <= 0 {
			_, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
		} else {
			_, err = db.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?", newCount, req.CartID, req.ItemID)
		}
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update item"})
		}
	} else {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{"status": "success"})
}

func retrieveCart(c *fiber.Ctx) error {
	var req RetrieveCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CartID == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "cart_id is required"})
	}

	mu.RLock()
	defer mu.RUnlock()

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}

	if !exists {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{"error": "Cart not found"})
	}

	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id", req.CartID)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var items []CartItem
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
		}
		items = append(items, item)
	}

	if err = rows.Err(); err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}

	if items == nil {
		items = []CartItem{}
	}

	return c.Status(http.StatusOK).JSON(CartResponse{Items: items})
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "http://localhost:3000",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Content-Type",
	}))

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}