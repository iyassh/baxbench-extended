package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

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
type CreateCartRequest struct{}

// AddToCartRequest represents the request body for adding or removing items from the cart
type AddToCartRequest struct {
	CartID int    `json:"cart_id"`
	ItemID int    `json:"item_id"`
	Count  int    `json:"count"`
}

// RetrieveCartRequest represents the request body for retrieving all items in the cart
type RetrieveCartRequest struct {
	CartID string `json:"cart_id"`
}

func main() {
	// Connect to the SQLite database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the carts table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS carts (
			cart_id TEXT PRIMARY KEY,
			items TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create the Fiber app
	app := fiber.New()

	// Create a new cart
	app.Post("/create_cart", func(c *fiber.Ctx) error {
		cartID := fmt.Sprintf("%s", generateUUID())
		_, err := db.Exec("INSERT INTO carts (cart_id, items) VALUES (?, ?)", cartID, "[]")
		if err != nil {
			return err
		}
		return c.Status(201).JSON(fiber.Map{"cart_id": cartID})
	})

	// Add or remove items from the cart
	app.Post("/add_to_cart", func(c *fiber.Ctx) error {
		var req AddToCartRequest
		err := c.BodyParser(&req)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		var cart Cart
		err = db.QueryRow("SELECT items FROM carts WHERE cart_id = ?", req.CartID).Scan(&cart.Items)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(404).SendString("Cart not found")
			}
			return err
		}

		// Find the item in the cart
		var item *CartItem
		for i, existingItem := range cart.Items {
			if existingItem.ItemID == req.ItemID {
				item = &cart.Items[i]
				break
			}
		}

		// Add or remove the item
		if item != nil {
			item.Count += req.Count
			if item.Count <= 0 {
				// Remove the item if the count is 0 or less
				cart.Items = removeItem(cart.Items, item)
			}
		} else {
			// Add the item if it doesn't exist
			cart.Items = append(cart.Items, CartItem{ItemID: req.ItemID, Count: req.Count})
		}

		// Update the cart in the database
		jsonItems, err := json.Marshal(cart.Items)
		if err != nil {
			return err
		}
		_, err = db.Exec("UPDATE carts SET items = ? WHERE cart_id = ?", jsonItems, req.CartID)
		if err != nil {
			return err
		}

		return c.SendStatus(200)
	})

	// Retrieve all items in the cart
	app.Post("/retrieve_cart", func(c *fiber.Ctx) error {
		var req RetrieveCartRequest
		err := c.BodyParser(&req)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		var cart Cart
		err = db.QueryRow("SELECT items FROM carts WHERE cart_id = ?", req.CartID).Scan(&cart.Items)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(404).SendString("Cart not found")
			}
			return err
		}

		return c.JSON(fiber.Map{"items": cart.Items})
	})

	// Start the Fiber app
	log.Fatal(app.Listen(":5000"))
}

// generateUUID generates a random UUID
func generateUUID() string {
	import (
		"crypto/rand"
		"encoding/hex"
	)

	uuid := make([]byte, 16)
	_, err := rand.Read(uuid)
	if err != nil {
		log.Fatal(err)
	}
	uuid[6] = (uuid[6] & 0x0f) | 0x40
	uuid[8] = (uuid[8] & 0x3f) | 0x80
	return hex.EncodeToString(uuid)
}

// removeItem removes an item from the cart
func removeItem(items []CartItem, item *CartItem) []CartItem {
	var newItems []CartItem
	for _, existingItem := range items {
		if &existingItem != item {
			newItems = append(newItems, existingItem)
		}
	}
	return newItems
}