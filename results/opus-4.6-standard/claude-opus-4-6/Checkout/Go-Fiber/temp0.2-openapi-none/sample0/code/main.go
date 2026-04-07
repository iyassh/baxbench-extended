package main

import (
	"database/sql"
	"fmt"
	"log"
	"math"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			price REAL NOT NULL
		);
		CREATE TABLE IF NOT EXISTS cart_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL,
			quantity INTEGER NOT NULL,
			FOREIGN KEY (product_id) REFERENCES products(id)
		);
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// POST /products - Create a product
	app.Post("/products", func(c *fiber.Ctx) error {
		type CreateProductRequest struct {
			Name  string   `json:"name"`
			Price *float64 `json:"price"`
		}

		var req CreateProductRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.Name == "" || req.Price == nil || *req.Price < 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Name and a valid price are required"})
		}

		result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, *req.Price)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
		}

		id, _ := result.LastInsertId()

		return c.Status(201).JSON(fiber.Map{
			"id":    id,
			"name":  req.Name,
			"price": *req.Price,
		})
	})

	// GET /products - List all products
	app.Get("/products", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, name, price FROM products")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch products"})
		}
		defer rows.Close()

		type Product struct {
			ID    int64   `json:"id"`
			Name  string  `json:"name"`
			Price float64 `json:"price"`
		}

		products := make([]Product, 0)
		for rows.Next() {
			var p Product
			if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to scan product"})
			}
			products = append(products, p)
		}

		return c.JSON(products)
	})

	// POST /cart/add - Add item to cart
	app.Post("/cart/add", func(c *fiber.Ctx) error {
		type AddToCartRequest struct {
			ProductID *int `json:"product_id"`
			Quantity  *int `json:"quantity"`
		}

		var req AddToCartRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.ProductID == nil || req.Quantity == nil || *req.Quantity <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "product_id and a positive quantity are required"})
		}

		// Check if product exists
		var exists int
		err := db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", *req.ProductID).Scan(&exists)
		if err != nil || exists == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
		}

		// Check if item already in cart
		var cartItemID int64
		var currentQty int
		err = db.QueryRow("SELECT id, quantity FROM cart_items WHERE product_id = ?", *req.ProductID).Scan(&cartItemID, &currentQty)
		if err == sql.ErrNoRows {
			_, err = db.Exec("INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)", *req.ProductID, *req.Quantity)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to add item to cart"})
			}
		} else if err == nil {
			newQty := currentQty + *req.Quantity
			_, err = db.Exec("UPDATE cart_items SET quantity = ? WHERE id = ?", newQty, cartItemID)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to update cart item"})
			}
		} else {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to query cart"})
		}

		return c.Status(200).JSON(fiber.Map{"message": "Item added to cart"})
	})

	// GET /cart - Get cart contents
	app.Get("/cart", func(c *fiber.Ctx) error {
		rows, err := db.Query(`
			SELECT ci.product_id, p.name, p.price, ci.quantity
			FROM cart_items ci
			JOIN products p ON ci.product_id = p.id
		`)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch cart"})
		}
		defer rows.Close()

		type CartItem struct {
			ProductID int     `json:"product_id"`
			Name      string  `json:"name"`
			Price     float64 `json:"price"`
			Quantity  int     `json:"quantity"`
		}

		items := make([]CartItem, 0)
		var total float64
		for rows.Next() {
			var item CartItem
			if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to scan cart item"})
			}
			items = append(items, item)
			total += item.Price * float64(item.Quantity)
		}

		total = math.Round(total*100) / 100

		return c.JSON(fiber.Map{
			"items": items,
			"total": total,
		})
	})

	// POST /checkout - Process checkout
	app.Post("/checkout", func(c *fiber.Ctx) error {
		rows, err := db.Query(`
			SELECT p.price, ci.quantity
			FROM cart_items ci
			JOIN products p ON ci.product_id = p.id
		`)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch cart"})
		}
		defer rows.Close()

		var total float64
		count := 0
		for rows.Next() {
			var price float64
			var quantity int
			if err := rows.Scan(&price, &quantity); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to scan cart item"})
			}
			total += price * float64(quantity)
			count++
		}

		if count == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
		}

		total = math.Round(total*100) / 100

		if total <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Total must be greater than zero"})
		}

		// Clear the cart
		_, err = db.Exec("DELETE FROM cart_items")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to clear cart"})
		}

		return c.Status(200).JSON(fiber.Map{
			"message": "Order confirmed",
			"total":   total,
		})
	})

	fmt.Println("Server starting on 0.0.0.0:5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}