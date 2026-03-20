package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS carts (
		id TEXT PRIMARY KEY,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	
	CREATE TABLE IF NOT EXISTS cart_items (
		cart_id TEXT,
		item_id INTEGER,
		count INTEGER,
		PRIMARY KEY (cart_id, item_id),
		FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func validateUUID(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil
}

func validateItemID(itemID int) bool {
	return itemID > 0
}

func createCart(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	stmt, err := db.Prepare("INSERT INTO carts (id) VALUES (?)")
	if err != nil {
		log.Printf("Database prepare error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(cartID)
	if err != nil {
		log.Printf("Database execution error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(CreateCartResponse{CartID: cartID})
}

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CartID == "" || !validateUUID(req.CartID) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid cart_id"})
	}

	if !validateItemID(req.ItemID) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid item_id"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Cart not found"})
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Transaction begin error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer tx.Rollback()

	var currentCount int
	err = tx.QueryRow("SELECT COALESCE(count, 0) FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID).Scan(&currentCount)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("Database query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	newCount := currentCount + req.Count

	if newCount <= 0 {
		_, err = tx.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
	} else {
		_, err = tx.Exec("INSERT OR REPLACE INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", req.CartID, req.ItemID, newCount)
	}

	if err != nil {
		log.Printf("Database execution error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if err = tx.Commit(); err != nil {
		log.Printf("Transaction commit error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Item updated successfully"})
}

func retrieveCart(c *fiber.Ctx) error {
	var req RetrieveCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CartID == "" || !validateUUID(req.CartID) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid cart_id"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Cart not found"})
	}

	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id", req.CartID)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var items []CartItem
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			log.Printf("Row scan error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Rows iteration error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if items == nil {
		items = []CartItem{}
	}

	return c.Status(200).JSON(RetrieveCartResponse{Items: items})
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
			
			if code == fiber.StatusInternalServerError {
				log.Printf("Internal server error: %v", err)
				return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
			}
			
			return c.Status(code).JSON(fiber.Map{"error": err.Error()})
		},
		DisableStartupMessage: false,
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		HSTSMaxAge:            31536000,
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(cors.New(cors.Config{
		AllowOrigins:     "https://localhost:*,https://127.0.0.1:*",
		AllowMethods:     "POST",
		AllowHeaders:     "Content-Type",
		AllowCredentials: false,
	}))

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		contentType := c.Get("Content-Type")
		if !strings.Contains(contentType, "application/json") {
			return c.Status(400).JSON(fiber.Map{"error": "Content-Type must be application/json"})
		}
		return c.Next()
	})

	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	app.Use(func(c *fiber.Ctx) error {
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}