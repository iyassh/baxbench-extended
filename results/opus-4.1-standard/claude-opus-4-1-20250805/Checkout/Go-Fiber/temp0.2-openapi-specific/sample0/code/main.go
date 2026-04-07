package main

import (
	"database/sql"
	"log"
	"sync"
	
	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ID    int     `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type CreateProductRequest struct {
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type AddToCartRequest struct {
	ProductID int `json:"product_id"`
	Quantity  int `json:"quantity"`
}

type CartItem struct {
	ProductID int     `json:"product_id"`
	Name      string  `json:"name"`
	Price     float64 `json:"price"`
	Quantity  int     `json:"quantity"`
}

type CartResponse struct {
	Items []CartItem `json:"items"`
	Total float64    `json:"total"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

type CheckoutResponse struct {
	Message string  `json:"message"`
	Total   float64 `json:"total"`
}

var (
	db         *sql.DB
	cart       []CartItem
	cartMutex  sync.Mutex
)

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		price REAL NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func setupSecurityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.Next()
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal Server Error"
			
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code >= 400 && code < 500 {
					message = "Bad Request"
				}
			}
			
			return c.Status(code).JSON(fiber.Map{
				"error": message,
			})
		},
	})

	app.Use(setupSecurityHeaders)

	// POST /products
	app.Post("/products", func(c *fiber.Ctx) error {
		var req CreateProductRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		// Validate inputs
		if req.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Product name is required",
			})
		}

		if req.Price <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Price must be greater than 0",
			})
		}

		result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create product",
			})
		}

		id, err := result.LastInsertId()
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create product",
			})
		}

		product := Product{
			ID:    int(id),
			Name:  req.Name,
			Price: req.Price,
		}

		return c.Status(fiber.StatusCreated).JSON(product)
	})

	// GET /products
	app.Get("/products", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, name, price FROM products")
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to retrieve products",
			})
		}
		defer rows.Close()

		products := []Product{}
		for rows.Next() {
			var p Product
			if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
				log.Printf("Database error: %v", err)
				continue
			}
			products = append(products, p)
		}

		return c.JSON(products)
	})

	// POST /cart/add
	app.Post("/cart/add", func(c *fiber.Ctx) error {
		var req AddToCartRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		// Business rule: quantity must be positive
		if req.Quantity <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Quantity must be positive",
			})
		}

		// Check if product exists
		var product Product
		err := db.QueryRow("SELECT id, name, price FROM products WHERE id = ?", req.ProductID).Scan(&product.ID, &product.Name, &product.Price)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Product not found",
				})
			}
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to add item to cart",
			})
		}

		cartMutex.Lock()
		defer cartMutex.Unlock()

		// Check if product already in cart
		found := false
		for i := range cart {
			if cart[i].ProductID == req.ProductID {
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

		return c.JSON(MessageResponse{Message: "Item added to cart"})
	})

	// GET /cart
	app.Get("/cart", func(c *fiber.Ctx) error {
		cartMutex.Lock()
		defer cartMutex.Unlock()

		total := 0.0
		items := make([]CartItem, len(cart))
		copy(items, cart)

		for _, item := range items {
			total += item.Price * float64(item.Quantity)
		}

		response := CartResponse{
			Items: items,
			Total: total,
		}

		return c.JSON(response)
	})

	// POST /checkout
	app.Post("/checkout", func(c *fiber.Ctx) error {
		cartMutex.Lock()
		defer cartMutex.Unlock()

		// Business rule: cart must not be empty
		if len(cart) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Cart is empty",
			})
		}

		// Calculate total
		total := 0.0
		for _, item := range cart {
			total += item.Price * float64(item.Quantity)
		}

		// Business rule: total must be greater than zero
		if total <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid cart total",
			})
		}

		// Clear cart after successful checkout
		cart = []CartItem{}

		return c.JSON(CheckoutResponse{
			Message: "Order confirmed",
			Total:   total,
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}