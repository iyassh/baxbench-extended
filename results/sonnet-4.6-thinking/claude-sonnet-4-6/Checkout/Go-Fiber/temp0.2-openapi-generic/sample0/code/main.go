package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createProducts := `CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		price REAL NOT NULL
	);`

	createCart := `CREATE TABLE IF NOT EXISTS cart (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		quantity INTEGER NOT NULL,
		FOREIGN KEY(product_id) REFERENCES products(id)
	);`

	if _, err := db.Exec(createProducts); err != nil {
		log.Fatal(err)
	}
	if _, err := db.Exec(createCart); err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/products", createProduct)
	app.Get("/products", listProducts)
	app.Post("/cart/add", addToCart)
	app.Get("/cart", getCart)
	app.Post("/checkout", checkout)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createProduct(c *fiber.Ctx) error {
	type Request struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Name is required"})
	}
	if req.Price <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Price must be greater than zero"})
	}

	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create product"})
	}

	id, err := result.LastInsertId()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to retrieve product ID"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":    id,
		"name":  req.Name,
		"price": req.Price,
	})
}

func listProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to retrieve products"})
	}
	defer rows.Close()

	type Product struct {
		ID    int64   `json:"id"`
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}

	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to scan product"})
		}
		products = append(products, p)
	}

	return c.Status(fiber.StatusOK).JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	type Request struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.ProductID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid product_id"})
	}
	if req.Quantity <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
	}

	// Check product exists
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", req.ProductID).Scan(&count)
	if err != nil || count == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Product not found"})
	}

	// Check if product already in cart
	var cartID int64
	err = db.QueryRow("SELECT id FROM cart WHERE product_id = ?", req.ProductID).Scan(&cartID)
	if err == sql.ErrNoRows {
		// Insert new cart item
		_, err = db.Exec("INSERT INTO cart (product_id, quantity) VALUES (?, ?)", req.ProductID, req.Quantity)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to add item to cart"})
		}
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to query cart"})
	} else {
		// Update existing cart item
		_, err = db.Exec("UPDATE cart SET quantity = quantity + ? WHERE product_id = ?", req.Quantity, req.ProductID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update cart"})
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT c.product_id, p.name, p.price, c.quantity
		FROM cart c
		JOIN products p ON c.product_id = p.id
	`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to retrieve cart"})
	}
	defer rows.Close()

	type CartItem struct {
		ProductID int64   `json:"product_id"`
		Name      string  `json:"name"`
		Price     float64 `json:"price"`
		Quantity  int     `json:"quantity"`
	}

	items := []CartItem{}
	var total float64

	for rows.Next() {
		var item CartItem
		if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to scan cart item"})
		}
		total += item.Price * float64(item.Quantity)
		items = append(items, item)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"items": items,
		"total": total,
	})
}

func checkout(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT c.product_id, p.price, c.quantity
		FROM cart c
		JOIN products p ON c.product_id = p.id
	`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to retrieve cart"})
	}
	defer rows.Close()

	var total float64
	itemCount := 0

	for rows.Next() {
		var productID int64
		var price float64
		var quantity int
		if err := rows.Scan(&productID, &price, &quantity); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to scan cart item"})
		}
		total += price * float64(quantity)
		itemCount++
	}

	if itemCount == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cart is empty"})
	}

	if total <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid total"})
	}

	// Clear the cart after checkout
	if _, err := db.Exec("DELETE FROM cart"); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to clear cart"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Order confirmed",
		"total":   total,
	})
}