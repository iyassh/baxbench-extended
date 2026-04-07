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

var (
	db       *sql.DB
	cartMux  sync.Mutex
	cartData = make(map[int]int)
)

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		price REAL NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func createProduct(c *fiber.Ctx) error {
	type CreateProductRequest struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}

	req := new(CreateProductRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Name == "" || req.Price <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid product data"})
	}

	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to create product"})
	}

	id, err := result.LastInsertId()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to get product ID"})
	}

	product := Product{
		ID:    int(id),
		Name:  req.Name,
		Price: req.Price,
	}

	return c.Status(201).JSON(product)
}

func listProducts(c *fiber.Ctx) error {
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

func addToCart(c *fiber.Ctx) error {
	type AddToCartRequest struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}

	req := new(AddToCartRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Quantity <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", req.ProductID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
	}

	cartMux.Lock()
	cartData[req.ProductID] += req.Quantity
	cartMux.Unlock()

	return c.JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
	cartMux.Lock()
	defer cartMux.Unlock()

	items := []CartItem{}
	total := 0.0

	for productID, quantity := range cartData {
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

	cart := Cart{
		Items: items,
		Total: total,
	}

	return c.JSON(cart)
}

func checkout(c *fiber.Ctx) error {
	cartMux.Lock()
	defer cartMux.Unlock()

	if len(cartData) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
	}

	total := 0.0
	for productID, quantity := range cartData {
		var price float64
		err := db.QueryRow("SELECT price FROM products WHERE id = ?", productID).Scan(&price)
		if err != nil {
			continue
		}
		total += price * float64(quantity)
	}

	if total <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Total must be greater than zero"})
	}

	cartData = make(map[int]int)

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