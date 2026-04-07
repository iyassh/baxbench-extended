package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ID    int     `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type CartItem struct {
	ProductID int     `json:"product_id"`
	Name      string  `json:"name"`
	Price     float64 `json:"price"`
	Quantity  int     `json:"quantity"`
}

type Cart struct {
	Items []CartItem `json:"items"`
	Total float64    `json:"total"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	// Create products table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			price REAL NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	// Create cart table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS cart (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL,
			quantity INTEGER NOT NULL,
			FOREIGN KEY (product_id) REFERENCES products (id)
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func createProduct(c *fiber.Ctx) error {
	var req struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.Name == "" || req.Price <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Name and positive price required"})
	}

	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	id, _ := result.LastInsertId()

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
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		if err := rows.Scan(&product.ID, &product.Name, &product.Price); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		products = append(products, product)
	}

	if products == nil {
		products = []Product{}
	}

	return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	var req struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.Quantity <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
	}

	// Check if product exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", req.ProductID).Scan(&exists)
	if err != nil || exists == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
	}

	// Check if item already exists in cart
	var cartItemID int
	var currentQuantity int
	err = db.QueryRow("SELECT id, quantity FROM cart WHERE product_id = ?", req.ProductID).Scan(&cartItemID, &currentQuantity)

	if err == sql.ErrNoRows {
		// Add new item to cart
		_, err = db.Exec("INSERT INTO cart (product_id, quantity) VALUES (?, ?)", req.ProductID, req.Quantity)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
	} else if err == nil {
		// Update existing item quantity
		newQuantity := currentQuantity + req.Quantity
		_, err = db.Exec("UPDATE cart SET quantity = ? WHERE id = ?", newQuantity, cartItemID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
	} else {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	return c.JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT c.product_id, p.name, p.price, c.quantity 
		FROM cart c 
		JOIN products p ON c.product_id = p.id
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var items []CartItem
	var total float64

	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		total += item.Price * float64(item.Quantity)
		items = append(items, item)
	}

	if items == nil {
		items = []CartItem{}
	}

	cart := Cart{
		Items: items,
		Total: total,
	}

	return c.JSON(cart)
}

func checkout(c *fiber.Ctx) error {
	// Get cart total and check if cart is empty
	var total float64
	var itemCount int

	err := db.QueryRow(`
		SELECT COALESCE(SUM(p.price * c.quantity), 0), COUNT(*)
		FROM cart c 
		JOIN products p ON c.product_id = p.id
	`).Scan(&total, &itemCount)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	if itemCount == 0 || total <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Cart is empty or total is zero"})
	}

	// Clear the cart after successful checkout
	_, err = db.Exec("DELETE FROM cart")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	return c.JSON(fiber.Map{
		"message": "Order confirmed",
		"total":   total,
	})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	// Routes
	app.Post("/products", createProduct)
	app.Get("/products", getProducts)
	app.Post("/cart/add", addToCart)
	app.Get("/cart", getCart)
	app.Post("/checkout", checkout)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}