package main

import (
	"database/sql"
	"fmt"
	"math"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var secret string

var rateLimitStoreData = struct {
	sync.Mutex
	data map[string][]time.Time
}{data: make(map[string][]time.Time)}

func rateLimit(maxRequests int, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		key := ip + ":" + c.Path()
		now := time.Now()
		rateLimitStoreData.Lock()
		times := rateLimitStoreData.data[key]
		var filtered []time.Time
		for _, t := range times {
			if now.Sub(t) < window {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) >= maxRequests {
			rateLimitStoreData.data[key] = filtered
			rateLimitStoreData.Unlock()
			return c.Status(429).JSON(fiber.Map{"error": "Rate limit exceeded"})
		}
		filtered = append(filtered, now)
		rateLimitStoreData.data[key] = filtered
		rateLimitStoreData.Unlock()
		return c.Next()
	}
}

func main() {
	secret = os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "checkout.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL)")
	db.Exec("CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (product_id) REFERENCES products(id))")
	db.Exec("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, total REAL NOT NULL, order_id TEXT UNIQUE NOT NULL)")

	app := fiber.New(fiber.Config{BodyLimit: 1024 * 1024})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		return c.Next()
	})

	app.Post("/products", rateLimit(30, time.Minute), createProduct)
	app.Get("/products", rateLimit(30, time.Minute), getProducts)
	app.Post("/cart/add", rateLimit(30, time.Minute), addToCart)
	app.Get("/cart", rateLimit(30, time.Minute), getCart)
	app.Post("/checkout", rateLimit(10, time.Minute), checkout)

	app.Listen(":5000")
}

func getUserFromToken(c *fiber.Ctx) string {
	auth := c.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	tokenStr := strings.TrimPrefix(auth, "Bearer ")
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return ""
	}
	claims := token.Claims.(jwt.MapClaims)
	return fmt.Sprintf("%v", claims["user_id"])
}

func createProduct(c *fiber.Ctx) error {
	var body struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name required"})
	}
	if len(body.Name) > 200 {
		return c.Status(400).JSON(fiber.Map{"error": "Name too long"})
	}
	if body.Price < 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Price must be non-negative"})
	}
	price := math.Round(body.Price*100) / 100
	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", body.Name, price)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id})
}

func getProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()
	var products []fiber.Map
	for rows.Next() {
		var id int
		var name string
		var price float64
		rows.Scan(&id, &name, &price)
		products = append(products, fiber.Map{"id": id, "name": name, "price": price})
	}
	if products == nil {
		products = []fiber.Map{}
	}
	return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var body struct {
		ProductID int `json:"product_id"`
		Quantity  int `json:"quantity"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.ProductID == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Product ID required"})
	}
	if body.Quantity <= 0 {
		body.Quantity = 1
	}
	if body.Quantity > 1000 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid quantity"})
	}
	var exists int
	err := db.QueryRow("SELECT id FROM products WHERE id = ?", body.ProductID).Scan(&exists)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
	}
	var existingId int
	err = db.QueryRow("SELECT id FROM cart_items WHERE user_id = ? AND product_id = ?", userId, body.ProductID).Scan(&existingId)
	if err == nil {
		db.Exec("UPDATE cart_items SET quantity = quantity + ? WHERE id = ?", body.Quantity, existingId)
	} else {
		db.Exec("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)", userId, body.ProductID, body.Quantity)
	}
	return c.JSON(fiber.Map{"message": "Added to cart"})
}

func getCart(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	rows, err := db.Query("SELECT c.product_id, p.name, p.price, c.quantity FROM cart_items c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?", userId)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()
	var items []fiber.Map
	total := 0.0
	for rows.Next() {
		var productId, quantity int
		var name string
		var price float64
		rows.Scan(&productId, &name, &price, &quantity)
		subtotal := math.Round(price*float64(quantity)*100) / 100
		total += subtotal
		items = append(items, fiber.Map{"product_id": productId, "name": name, "price": price, "quantity": quantity, "subtotal": subtotal})
	}
	if items == nil {
		items = []fiber.Map{}
	}
	return c.JSON(fiber.Map{"items": items, "total": math.Round(total*100) / 100})
}

func checkout(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	rows, err := tx.Query("SELECT p.price, c.quantity FROM cart_items c JOIN products p ON c.product_id = p.id WHERE c.user_id = ?", userId)
	if err != nil {
		tx.Rollback()
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	total := 0.0
	count := 0
	for rows.Next() {
		var price float64
		var quantity int
		rows.Scan(&price, &quantity)
		total += price * float64(quantity)
		count++
	}
	rows.Close()

	if count == 0 {
		tx.Rollback()
		return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
	}
	total = math.Round(total*100) / 100
	orderId := uuid.New().String()
	tx.Exec("INSERT INTO orders (user_id, total, order_id) VALUES (?, ?, ?)", userId, total, orderId)
	tx.Exec("DELETE FROM cart_items WHERE user_id = ?", userId)
	tx.Commit()

	return c.JSON(fiber.Map{"order_id": orderId, "total": total, "message": "Order placed successfully"})
}
