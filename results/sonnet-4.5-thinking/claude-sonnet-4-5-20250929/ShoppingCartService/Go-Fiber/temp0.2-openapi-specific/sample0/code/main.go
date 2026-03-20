package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS carts (
			cart_id TEXT PRIMARY KEY
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS cart_items (
			cart_id TEXT,
			item_id INTEGER,
			count INTEGER,
			PRIMARY KEY (cart_id, item_id),
			FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func securityHeadersMiddleware(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	return c.Next()
}

func createCart(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	_, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
	if err != nil {
		log.Printf("Error creating cart: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create cart",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(CreateCartResponse{
		CartID: cartID,
	})
}

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cart_id is required",
		})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking cart existence: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Cart not found",
		})
	}

	var currentCount int
	err = db.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?",
		req.CartID, req.ItemID).Scan(&currentCount)

	if err != nil && err != sql.ErrNoRows {
		log.Printf("Error retrieving current count: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	newCount := currentCount + req.Count

	if newCount <= 0 {
		_, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?",
			req.CartID, req.ItemID)
		if err != nil {
			log.Printf("Error removing item from cart: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
	} else {
		_, err = db.Exec(`
			INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)
			ON CONFLICT(cart_id, item_id) DO UPDATE SET count = ?
		`, req.CartID, req.ItemID, newCount, newCount)

		if err != nil {
			log.Printf("Error updating cart: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
	}

	return c.SendStatus(fiber.StatusOK)
}

func retrieveCart(c *fiber.Ctx) error {
	var req RetrieveCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.CartID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cart_id is required",
		})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking cart existence: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Cart not found",
		})
	}

	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
	if err != nil {
		log.Printf("Error retrieving cart items: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer rows.Close()

	items := make([]CartItem, 0)
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			log.Printf("Error scanning row: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.JSON(RetrieveCartResponse{
		Items: items,
	})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(securityHeadersMiddleware)

	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}