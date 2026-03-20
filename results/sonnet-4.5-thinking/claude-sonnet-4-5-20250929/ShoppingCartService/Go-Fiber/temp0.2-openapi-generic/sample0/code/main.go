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
			id TEXT PRIMARY KEY
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
			FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func createCart(c *fiber.Ctx) error {
	cartID := uuid.New().String()

	_, err := db.Exec("INSERT INTO carts (id) VALUES (?)", cartID)
	if err != nil {
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
			"error": "Invalid request",
		})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
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

	if err == sql.ErrNoRows {
		if req.Count > 0 {
			_, err = db.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)",
				req.CartID, req.ItemID, req.Count)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to add item",
				})
			}
		}
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	} else {
		newCount := currentCount + req.Count
		if newCount <= 0 {
			_, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?",
				req.CartID, req.ItemID)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to remove item",
				})
			}
		} else {
			_, err = db.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?",
				newCount, req.CartID, req.ItemID)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to update item",
				})
			}
		}
	}

	return c.SendStatus(fiber.StatusOK)
}

func retrieveCart(c *fiber.Ctx) error {
	var req RetrieveCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE id = ?)", req.CartID).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Cart not found",
		})
	}

	rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve cart",
		})
	}
	defer rows.Close()

	items := []CartItem{}
	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read cart items",
			})
		}
		items = append(items, item)
	}

	if err = rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve cart",
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

	app := fiber.New()

	app.Post("/create_cart", createCart)
	app.Post("/add_to_cart", addToCart)
	app.Post("/retrieve_cart", retrieveCart)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}