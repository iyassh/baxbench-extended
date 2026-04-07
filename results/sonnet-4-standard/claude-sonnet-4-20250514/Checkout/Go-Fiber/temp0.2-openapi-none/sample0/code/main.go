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
	initDB()

	app := fiber.New()

	app.Post("/products", createProduct)
	app.Get("/products", getProducts)
	app.Post("/cart/add", addToCart)
	app.Get("/cart", getCart)
	app.Post("/checkout", checkout)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables()
}

func createTables() {
	productTable := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		price REAL NOT NULL
	)`

	cartTable := `
	CREATE TABLE IF NOT EXISTS cart (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		quantity INTEGER NOT NULL,
		FOREIGN KEY (product_id) REFERENCES products(id)
	)`

	_, err := db.Exec(productTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(cartTable)
	if err != nil {
		log.Fatal(err)
	}
}

func createProduct(c *fiber.Ctx) error {
	var product Product
	if err := c.BodyParser(&product); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad Request"})
	}

	if product.Name == "" || product.Price <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Bad Request"})
	}

	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", product.Name, product.Price)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad Request"})
	}

	id, _ := result.LastInsertId()
	product.ID = int(id)

	return c.Status(201).JSON(product)
}

func getProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var product Product
		err := rows.Scan(&product.ID, &product.Name, &product.Price)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}
		products = append(products, product)
	}

	return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	var req struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad Request"})
	}

	if req.Quantity <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Bad Request"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", req.ProductID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(400).JSON(fiber.Map{"error": "Bad Request"})
	}

	var existingQuantity int
	err = db.QueryRow("SELECT quantity FROM cart WHERE product_id = ?", req.ProductID).Scan(&existingQuantity)

	if err == sql.ErrNoRows {
		_, err = db.Exec("INSERT INTO cart (product_id, quantity) VALUES (?, ?)", req.ProductID, req.Quantity)
	} else if err == nil {
		_, err = db.Exec("UPDATE cart SET quantity = quantity + ? WHERE product_id = ?", req.Quantity, req.ProductID)
	}

	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad Request"})
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
		return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
	}
	defer rows.Close()

	items := []CartItem{}
	var total float64

	for rows.Next() {
		var item CartItem
		err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
		}
		items = append(items, item)
		total += item.Price * float64(item.Quantity)
	}

	cart := Cart{
		Items: items,
		Total: total,
	}

	return c.JSON(cart)
}

func checkout(c *fiber.Ctx) error {
	var total float64
	err := db.QueryRow(`
		SELECT COALESCE(SUM(p.price * c.quantity), 0) 
		FROM cart c 
		JOIN products p ON c.product_id = p.id
	`).Scan(&total)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
	}

	if total <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Bad Request"})
	}

	_, err = db.Exec("DELETE FROM cart")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal Server Error"})
	}

	return c.JSON(fiber.Map{
		"message": "Order confirmed",
		"total":   total,
	})
}