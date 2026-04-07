package main

import (
	"database/sql"
	"log"
	"math"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var (
	db   *sql.DB
	mu   sync.Mutex
	cart []CartItem
)

type Product struct {
	ID    int64   `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type CartItem struct {
	ProductID int64   `json:"product_id"`
	Name      string  `json:"name"`
	Price     float64 `json:"price"`
	Quantity  int     `json:"quantity"`
}

type AddToCartRequest struct {
	ProductID int64 `json:"product_id"`
	Quantity  int   `json:"quantity"`
}

type CreateProductRequest struct {
	Name  *string  `json:"name"`
	Price *float64 `json:"price"`
}

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
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func roundToTwoDecimals(val float64) float64 {
	return math.Round(val*100) / 100
}

func main() {
	initDB()
	defer func() {
		if db != nil {
			db.Close()
		}
	}()

	cart = make([]CartItem, 0)

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	app.Use(securityHeaders)

	app.Post("/products", func(c *fiber.Ctx) error {
		var req CreateProductRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.Name == nil || req.Price == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Name and price are required"})
		}

		name := strings.TrimSpace(*req.Name)
		price := *req.Price

		if name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Name must not be empty"})
		}

		if price < 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Price must be non-negative"})
		}

		if math.IsNaN(price) || math.IsInf(price, 0) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Price must be a valid number"})
		}

		price = roundToTwoDecimals(price)

		result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", name, price)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create product"})
		}

		id, err := result.LastInsertId()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to retrieve product ID"})
		}

		return c.Status(fiber.StatusCreated).JSON(Product{
			ID:    id,
			Name:  name,
			Price: price,
		})
	})

	app.Get("/products", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, name, price FROM products")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to retrieve products"})
		}
		defer rows.Close()

		products := make([]Product, 0)
		for rows.Next() {
			var p Product
			if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to read product data"})
			}
			products = append(products, p)
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to iterate products"})
		}

		return c.JSON(products)
	})

	app.Post("/cart/add", func(c *fiber.Ctx) error {
		var req AddToCartRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.Quantity <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
		}

		if req.ProductID <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid product ID"})
		}

		var product Product
		err := db.QueryRow("SELECT id, name, price FROM products WHERE id = ?", req.ProductID).Scan(&product.ID, &product.Name, &product.Price)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Product not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to look up product"})
		}

		mu.Lock()
		defer mu.Unlock()

		found := false
		for i, item := range cart {
			if item.ProductID == req.ProductID {
				cart[i].Quantity += req.Quantity
				found = true
				break
			}
		}

		if !found {
			cart = append(cart, CartItem{
				ProductID: product.ID,
				Name:      product.Name,
				Price:     product.Price,
				Quantity:  req.Quantity,
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Item added to cart"})
	})

	app.Get("/cart", func(c *fiber.Ctx) error {
		mu.Lock()
		defer mu.Unlock()

		total := 0.0
		items := make([]CartItem, len(cart))
		copy(items, cart)

		for _, item := range items {
			total += item.Price * float64(item.Quantity)
		}

		total = roundToTwoDecimals(total)

		return c.JSON(fiber.Map{
			"items": items,
			"total": total,
		})
	})

	app.Post("/checkout", func(c *fiber.Ctx) error {
		mu.Lock()
		defer mu.Unlock()

		if len(cart) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cart is empty"})
		}

		total := 0.0
		for _, item := range cart {
			if item.Quantity <= 0 {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid item quantity in cart"})
			}
			total += item.Price * float64(item.Quantity)
		}

		total = roundToTwoDecimals(total)

		if total <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cart total must be greater than zero"})
		}

		// Clear the cart after successful checkout
		cart = make([]CartItem, 0)

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"message": "Order confirmed",
			"total":   total,
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}