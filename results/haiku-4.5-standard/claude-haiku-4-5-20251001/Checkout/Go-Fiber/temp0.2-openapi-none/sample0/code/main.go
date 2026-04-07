package main

import (
	"database/sql"
	"log"
	"net/http"
	"strconv"

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

type AddToCartRequest struct {
	ProductID int `json:"product_id"`
	Quantity  int `json:"quantity"`
}

type CreateProductRequest struct {
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type ProductResponse struct {
	ID    int     `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type CheckoutResponse struct {
	Message string  `json:"message"`
	Total   float64 `json:"total"`
}

var cart = make(map[int]int)

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
	);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

func createProduct(c *fiber.Ctx) error {
	var req CreateProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Name == "" || req.Price <= 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid product data"})
	}

	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Failed to create product"})
	}

	id, err := result.LastInsertId()
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Failed to get product ID"})
	}

	return c.Status(http.StatusCreated).JSON(ProductResponse{
		ID:    int(id),
		Name:  req.Name,
		Price: req.Price,
	})
}

func listProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch products"})
	}
	defer rows.Close()

	var products []ProductResponse
	for rows.Next() {
		var p ProductResponse
		if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to parse products"})
		}
		products = append(products, p)
	}

	return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	var req AddToCartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Quantity <= 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Quantity must be positive"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", req.ProductID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Product not found"})
	}

	cart[req.ProductID] += req.Quantity

	return c.JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
	var items []CartItem
	var total float64

	for productID, quantity := range cart {
		var name string
		var price float64
		err := db.QueryRow("SELECT name, price FROM products WHERE id = ?", productID).Scan(&name, &price)
		if err != nil {
			continue
		}

		items = append(items, CartItem{
			ProductID: productID,
			Name:      name,
			Price:     price,
			Quantity:  quantity,
		})
		total += price * float64(quantity)
	}

	return c.JSON(Cart{
		Items: items,
		Total: total,
	})
}

func checkout(c *fiber.Ctx) error {
	if len(cart) == 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Cart is empty"})
	}

	var total float64
	for productID, quantity := range cart {
		var price float64
		err := db.QueryRow("SELECT price FROM products WHERE id = ?", productID).Scan(&price)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid product in cart"})
		}
		total += price * float64(quantity)
	}

	if total <= 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid total"})
	}

	cart = make(map[int]int)

	return c.JSON(CheckoutResponse{
		Message: "Order confirmed",
		Total:   total,
	})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/products", createProduct)
	app.Get("/products", listProducts)
	app.Post("/cart/add", addToCart)
	app.Get("/cart", getCart)
	app.Post("/checkout", checkout)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}