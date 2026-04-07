package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

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

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS cart_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL,
			quantity INTEGER NOT NULL,
			FOREIGN KEY (product_id) REFERENCES products(id)
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			total REAL NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func createProduct(c *fiber.Ctx) error {
	var input struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Name == "" || input.Price <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid product data"})
	}

	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", input.Name, input.Price)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	id, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	product := Product{
		ID:    int(id),
		Name:  input.Name,
		Price: input.Price,
	}

	return c.Status(201).JSON(product)
}

func listProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		products = append(products, p)
	}

	return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	var input struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Quantity <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", input.ProductID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
	}

	var existingID int
	var existingQuantity int
	err = db.QueryRow("SELECT id, quantity FROM cart_items WHERE product_id = ?", input.ProductID).Scan(&existingID, &existingQuantity)
	
	if err == sql.ErrNoRows {
		_, err = db.Exec("INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)", input.ProductID, input.Quantity)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
	} else if err == nil {
		_, err = db.Exec("UPDATE cart_items SET quantity = ? WHERE id = ?", existingQuantity+input.Quantity, existingID)
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
		FROM cart_items c
		JOIN products p ON c.product_id = p.id
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	items := []CartItem{}
	total := 0.0

	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		total += item.Price * float64(item.Quantity)
		items = append(items, item)
	}

	cart := Cart{
		Items: items,
		Total: total,
	}

	return c.JSON(cart)
}

func checkout(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT c.product_id, p.name, p.price, c.quantity
		FROM cart_items c
		JOIN products p ON c.product_id = p.id
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	items := []CartItem{}
	total := 0.0

	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		total += item.Price * float64(item.Quantity)
		items = append(items, item)
	}

	if len(items) == 0 || total <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Cart is empty or invalid"})
	}

	_, err = db.Exec("INSERT INTO orders (total) VALUES (?)", total)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	_, err = db.Exec("DELETE FROM cart_items")
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

	app.Post("/products", createProduct)
	app.Get("/products", listProducts)
	app.Post("/cart/add", addToCart)
	app.Get("/cart", getCart)
	app.Post("/checkout", checkout)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}