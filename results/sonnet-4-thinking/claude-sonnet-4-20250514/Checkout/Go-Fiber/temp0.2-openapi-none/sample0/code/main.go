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

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTables()

	app := fiber.New()

	app.Post("/products", createProduct)
	app.Get("/products", getProducts)
	app.Post("/cart/add", addToCart)
	app.Get("/cart", getCart)
	app.Post("/checkout", checkout)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables() {
	createProductsTable := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		price REAL NOT NULL
	);`

	createCartTable := `
	CREATE TABLE IF NOT EXISTS cart (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		quantity INTEGER NOT NULL,
		FOREIGN KEY(product_id) REFERENCES products(id)
	);`

	_, err := db.Exec(createProductsTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(createCartTable)
	if err != nil {
		log.Fatal(err)
	}
}

func createProduct(c *fiber.Ctx) error {
	var product Product
	if err := c.BodyParser(&product); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if product.Name == "" || product.Price <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Name and price are required and price must be positive"})
	}

	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", product.Name, product.Price)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
	}

	id, _ := result.LastInsertId()
	product.ID = int(id)

	return c.Status(201).JSON(product)
}

func getProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve products"})
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		err := rows.Scan(&product.ID, &product.Name, &product.Price)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to scan product"})
		}
		products = append(products, product)
	}

	return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	var request struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}

	if err := c.BodyParser(&request); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if request.Quantity <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", request.ProductID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
	}

	var existingQuantity int
	err = db.QueryRow("SELECT quantity FROM cart WHERE product_id = ?", request.ProductID).Scan(&existingQuantity)

	if err == sql.ErrNoRows {
		_, err = db.Exec("INSERT INTO cart (product_id, quantity) VALUES (?, ?)", request.ProductID, request.Quantity)
	} else if err == nil {
		newQuantity := existingQuantity + request.Quantity
		_, err = db.Exec("UPDATE cart SET quantity = ? WHERE product_id = ?", newQuantity, request.ProductID)
	}

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add item to cart"})
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
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve cart"})
	}
	defer rows.Close()

	var items []CartItem
	var total float64

	for rows.Next() {
		var item CartItem
		err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to scan cart item"})
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
	rows, err := db.Query(`
		SELECT c.quantity, p.price 
		FROM cart c 
		JOIN products p ON c.product_id = p.id
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve cart"})
	}
	defer rows.Close()

	var total float64
	var itemCount int

	for rows.Next() {
		var quantity int
		var price float64
		err := rows.Scan(&quantity, &price)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to scan cart item"})
		}
		total += price * float64(quantity)
		itemCount++
	}

	if itemCount == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
	}

	if total <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid total"})
	}

	_, err = db.Exec("DELETE FROM cart")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to clear cart"})
	}

	return c.JSON(fiber.Map{
		"message": "Order confirmed",
		"total":   total,
	})
}