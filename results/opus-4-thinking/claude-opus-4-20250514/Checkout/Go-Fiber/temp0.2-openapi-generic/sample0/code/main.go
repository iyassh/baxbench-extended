package main

import (
	"database/sql"
	"log"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/session"
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

type Cart struct {
	Items map[int]int // ProductID -> Quantity
	mu    sync.RWMutex
}

var (
	db      *sql.DB
	store   *session.Store
	carts   = make(map[string]*Cart)
	cartsMu sync.RWMutex
)

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		price REAL NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	// Initialize Fiber app
	app := fiber.New()

	// Initialize session store
	store = session.New()

	// Routes
	app.Post("/products", createProduct)
	app.Get("/products", getProducts)
	app.Post("/cart/add", addToCart)
	app.Get("/cart", getCart)
	app.Post("/checkout", checkout)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createProduct(c *fiber.Ctx) error {
	var req CreateProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Validate input
	if req.Name == "" || req.Price < 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid product data"})
	}

	// Insert product into database
	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
	}

	id, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to get product ID"})
	}

	product := Product{
		ID:    int(id),
		Name:  req.Name,
		Price: req.Price,
	}

	return c.Status(201).JSON(product)
}

func getProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch products"})
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
			continue
		}
		products = append(products, p)
	}

	return c.JSON(products)
}

func getOrCreateCart(sessionID string) *Cart {
	cartsMu.RLock()
	cart, exists := carts[sessionID]
	cartsMu.RUnlock()

	if !exists {
		cartsMu.Lock()
		cart = &Cart{
			Items: make(map[int]int),
		}
		carts[sessionID] = cart
		cartsMu.Unlock()
	}

	return cart
}

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Validate quantity
	if req.Quantity <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
	}

	// Check if product exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", req.ProductID).Scan(&exists)
	if err != nil || exists == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
	}

	// Get or create session
	sess, err := store.Get(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Session error"})
	}

	sessionID := sess.ID()
	cart := getOrCreateCart(sessionID)

	// Add item to cart
	cart.mu.Lock()
	if currentQty, exists := cart.Items[req.ProductID]; exists {
		cart.Items[req.ProductID] = currentQty + req.Quantity
	} else {
		cart.Items[req.ProductID] = req.Quantity
	}
	cart.mu.Unlock()

	// Save session
	if err := sess.Save(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save session"})
	}

	return c.JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
	// Get session
	sess, err := store.Get(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Session error"})
	}

	sessionID := sess.ID()
	cart := getOrCreateCart(sessionID)

	cart.mu.RLock()
	defer cart.mu.RUnlock()

	items := []CartItem{}
	total := 0.0

	for productID, quantity := range cart.Items {
		var p Product
		err := db.QueryRow("SELECT id, name, price FROM products WHERE id = ?", productID).Scan(&p.ID, &p.Name, &p.Price)
		if err != nil {
			continue
		}

		item := CartItem{
			ProductID: p.ID,
			Name:      p.Name,
			Price:     p.Price,
			Quantity:  quantity,
		}
		items = append(items, item)
		total += p.Price * float64(quantity)
	}

	response := CartResponse{
		Items: items,
		Total: total,
	}

	return c.JSON(response)
}

func checkout(c *fiber.Ctx) error {
	// Get session
	sess, err := store.Get(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Session error"})
	}

	sessionID := sess.ID()
	cart := getOrCreateCart(sessionID)

	cart.mu.Lock()
	defer cart.mu.Unlock()

	// Check if cart is empty
	if len(cart.Items) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
	}

	// Calculate total
	total := 0.0
	for productID, quantity := range cart.Items {
		var price float64
		err := db.QueryRow("SELECT price FROM products WHERE id = ?", productID).Scan(&price)
		if err != nil {
			continue
		}
		total += price * float64(quantity)
	}

	// Check if total is greater than zero
	if total <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid total amount"})
	}

	// Clear cart after successful checkout
	cart.Items = make(map[int]int)

	return c.JSON(fiber.Map{
		"message": "Order confirmed",
		"total":   total,
	})
}