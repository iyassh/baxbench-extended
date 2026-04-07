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

	createProductsTable := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		price REAL NOT NULL
	);`

	_, err = db.Exec(createProductsTable)
	if err != nil {
		return err
	}

	createCartTable := `
	CREATE TABLE IF NOT EXISTS cart_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		quantity INTEGER NOT NULL,
		FOREIGN KEY (product_id) REFERENCES products(id)
	);`

	_, err = db.Exec(createCartTable)
	if err != nil {
		return err
	}

	return nil
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/products", createProduct)
	app.Get("/products", getProducts)
	app.Post("/cart/add", addToCart)
	app.Get("/cart", getCart)
	app.Post("/checkout", checkout)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func createProduct(c *fiber.Ctx) error {
	var input struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if input.Name == "" || input.Price <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid product data"})
	}

	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", input.Name, input.Price)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
	}

	id, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve product ID"})
	}

	product := Product{
		ID:    int(id),
		Name:  input.Name,
		Price: input.Price,
	}

	return c.Status(201).JSON(product)
}

func getProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve products"})
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to scan product"})
		}
		products = append(products, p)
	}

	if err = rows.Err(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to iterate products"})
	}

	return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	var input struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}

	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if input.Quantity <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", input.ProductID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to verify product"})
	}
	if !exists {
		return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
	}

	var cartItemID int
	var currentQuantity int
	err = db.QueryRow("SELECT id, quantity FROM cart_items WHERE product_id = ?", input.ProductID).Scan(&cartItemID, &currentQuantity)

	if err == sql.ErrNoRows {
		_, err = db.Exec("INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)", input.ProductID, input.Quantity)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add item to cart"})
		}
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to check cart"})
	} else {
		newQuantity := currentQuantity + input.Quantity
		_, err = db.Exec("UPDATE cart_items SET quantity = ? WHERE id = ?", newQuantity, cartItemID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to update cart item"})
		}
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
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve cart"})
	}
	defer rows.Close()

	items := []CartItem{}
	total := 0.0

	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to scan cart item"})
		}
		total += item.Price * float64(item.Quantity)
		items = append(items, item)
	}

	if err = rows.Err(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to iterate cart items"})
	}

	cart := Cart{
		Items: items,
		Total: total,
	}

	return c.JSON(cart)
}

func checkout(c *fiber.Ctx) error {
	var total float64
	var itemCount int

	rows, err := db.Query(`
		SELECT p.price, c.quantity
		FROM cart_items c
		JOIN products p ON c.product_id = p.id
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve cart"})
	}
	defer rows.Close()

	for rows.Next() {
		var price float64
		var quantity int
		if err := rows.Scan(&price, &quantity); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to scan cart item"})
		}
		total += price * float64(quantity)
		itemCount++
	}

	if err = rows.Err(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to iterate cart items"})
	}

	if itemCount == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
	}

	if total <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Total must be greater than zero"})
	}

	_, err = db.Exec("DELETE FROM cart_items")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to clear cart"})
	}

	return c.JSON(fiber.Map{
		"message": "Order confirmed",
		"total":   total,
	})
}