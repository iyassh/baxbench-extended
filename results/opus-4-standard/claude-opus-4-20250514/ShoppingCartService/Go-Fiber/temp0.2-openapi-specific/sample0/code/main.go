package main

import (
	"database/sql"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableQuery := `
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

	_, err = db.Exec(createTableQuery)
	return err
}

func createCart(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	_, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
	if err != nil {
		log.Printf("Error creating cart: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create cart",
		})
	}

	return c.Status(http.StatusCreated).JSON(CreateCartResponse{
		CartID: cartID,
	})
}

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate input
	if req.CartID == "" || req.Count == 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request parameters",
		})
	}

	// Check if cart exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking cart existence: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	if !exists {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Cart not found",
		})
	}

	// Begin transaction
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	defer tx.Rollback()

	// Check current count
	var currentCount int
	err = tx.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID).Scan(&currentCount)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("Error querying cart items: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	newCount := currentCount + req.Count

	if newCount <= 0 {
		// Remove item from cart
		_, err = tx.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
	} else if currentCount == 0 {
		// Insert new item
		_, err = tx.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", req.CartID, req.ItemID, newCount)
	} else {
		// Update existing item
		_, err = tx.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?", newCount, req.CartID, req.ItemID)
	}

	if err != nil {
		log.Printf("Error updating cart items: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	if err = tx.Commit(); err != nil {
		log.Printf("Error committing transaction: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	return c.SendStatus(http.StatusOK)
}

func retrieveCart(c *fiber.Ctx) error {
	var req RetrieveCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate input
	if req.CartID == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request parameters",
		})
	}

	// Check if cart exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking cart existence: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	if !exists {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Cart not found",
		})
	}

	// Retrieve items
	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
	if err != nil {
		log.Printf("Error querying cart items: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	defer rows.Close()

	items := []CartItem{}
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			log.Printf("Error scanning cart items: %v", err)
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
				"error": "Database error",
			})
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating cart items: %v", err)
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
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

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Routes
	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}