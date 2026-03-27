package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// CartItem represents an item in the cart
type CartItem struct {
	ItemID int `json:"item_id"`
	Count  int `json:"count"`
}

// Cart represents a shopping cart
type Cart struct {
	CartID string      `json:"cart_id"`
	Items  []CartItem `json:"items"`
}

// CreateCartRequest represents the request body for creating a new cart
type CreateCartRequest struct {
}

// AddToCartRequest represents the request body for adding or removing items from the cart
type AddToCartRequest struct {
	CartID int    `json:"cart_id"`
	ItemID int    `json:"item_id"`
	Count  int    `json:"count"`
	CartUUID string `json:"cart_uuid"`
}

// RetrieveCartRequest represents the request body for retrieving all items in the cart
type RetrieveCartRequest struct {
	CartUUID string `json:"cart_uuid"`
}

var db *sql.DB

func main() {
	// Connect to the SQLite database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the carts table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS carts (
			uuid TEXT PRIMARY KEY,
			items TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create the Fiber app
	app := fiber.New()

	// Define the API routes
	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	// Start the server
	log.Fatal(app.Listen(":5000"))
}

// createCart creates a new shopping cart
func createCart(c *fiber.Ctx) error {
	// Generate a unique UUID for the cart
	uuid := generateUUID()

	// Insert the new cart into the database
	_, err := db.Exec("INSERT INTO carts (uuid, items) VALUES (?, ?)", uuid, "[]")
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Failed to create cart")
	}

	// Return the cart ID
	return c.Status(http.StatusCreated).JSON(fiber.Map{"cart_id": uuid})
}

// addToCart adds or removes items from the cart
func addToCart(c *fiber.Ctx) error {
	// Parse the request body
	var req AddToCartRequest
	err := c.BodyParser(&req)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid request")
	}

	// Retrieve the cart from the database
	var cart Cart
	err = db.QueryRow("SELECT items FROM carts WHERE uuid = ?", req.CartUUID).Scan(&cart.Items)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(http.StatusNotFound).SendString("Cart not found")
		}
		return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve cart")
	}

	// Add or remove the item from the cart
	for i, item := range cart.Items {
		if item.ItemID == req.ItemID {
			cart.Items[i].Count += req.Count
			if cart.Items[i].Count <= 0 {
				cart.Items = append(cart.Items[:i], cart.Items[i+1:]...)
			}
			break
		}
	}
	if req.Count > 0 {
		cart.Items = append(cart.Items, CartItem{ItemID: req.ItemID, Count: req.Count})
	}

	// Update the cart in the database
	jsonItems, err := json.Marshal(cart.Items)
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Failed to update cart")
	}
	_, err = db.Exec("UPDATE carts SET items = ? WHERE uuid = ?", jsonItems, req.CartUUID)
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Failed to update cart")
	}

	// Return a success response
	return c.SendStatus(http.StatusOK)
}

// retrieveCart retrieves all items in the cart
func retrieveCart(c *fiber.Ctx) error {
	// Parse the request body
	var req RetrieveCartRequest
	err := c.BodyParser(&req)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid request")
	}

	// Retrieve the cart from the database
	var cart Cart
	err = db.QueryRow("SELECT items FROM carts WHERE uuid = ?", req.CartUUID).Scan(&cart.Items)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(http.StatusNotFound).SendString("Cart not found")
		}
		return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve cart")
	}

	// Return the cart items
	return c.JSON(fiber.Map{"items": cart.Items})
}

// generateUUID generates a unique UUID
func generateUUID() string {
	return fmt.Sprintf("%x", uuid.New())
}