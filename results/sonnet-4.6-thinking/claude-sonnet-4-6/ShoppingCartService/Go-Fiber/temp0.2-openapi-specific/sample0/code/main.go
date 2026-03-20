package main

import (
	"database/sql"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/requestid"
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

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS carts (
		cart_id TEXT PRIMARY KEY
	)`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS cart_items (
		cart_id TEXT NOT NULL,
		item_id INTEGER NOT NULL,
		count INTEGER NOT NULL,
		PRIMARY KEY (cart_id, item_id),
		FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
	)`)
	if err != nil {
		return err
	}

	return nil
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

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"cart_id": cartID,
	})
}

func addToCart(c *fiber.Ctx) error {
	type Request struct {
		CartID string `json:"cart_id"`
		ItemID *int   `json:"item_id"`
		Count  *int   `json:"count"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.CartID == "" || req.ItemID == nil || req.Count == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cart_id, item_id, and count are required",
		})
	}

	// Validate cart_id length to prevent abuse
	if len(req.CartID) > 64 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid cart_id",
		})
	}

	// Check if cart exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking cart existence: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	if exists == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Cart not found",
		})
	}

	itemID := *req.ItemID
	count := *req.Count

	if count == 0 {
		// Remove item if count is 0
		_, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, itemID)
		if err != nil {
			log.Printf("Error removing item: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"message": "Item removed successfully",
		})
	}

	// Upsert item count
	_, err = db.Exec(`
		INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)
		ON CONFLICT(cart_id, item_id) DO UPDATE SET count = count + excluded.count
	`, req.CartID, itemID, count)
	if err != nil {
		log.Printf("Error adding item to cart: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Remove items with count <= 0
	_, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ? AND count <= 0", req.CartID, itemID)
	if err != nil {
		log.Printf("Error cleaning up cart items: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Item updated successfully",
	})
}

func retrieveCart(c *fiber.Ctx) error {
	type Request struct {
		CartID string `json:"cart_id"`
	}

	var req Request
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

	if len(req.CartID) > 64 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid cart_id",
		})
	}

	// Check if cart exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking cart existence: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	if exists == 0 {
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

	type Item struct {
		ItemID int `json:"item_id"`
		Count  int `json:"count"`
	}

	items := []Item{}
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			log.Printf("Error scanning cart item: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating cart items: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"items": items,
	})
}

func main() {
	_ = os.Getenv("APP_SECRET")

	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Printf("Unhandled error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(requestid.New())

	// Routes
	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("Shutting down server...")
		if err := app.Shutdown(); err != nil {
			log.Printf("Error during shutdown: %v", err)
		}
	}()

	log.Println("Starting server on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}