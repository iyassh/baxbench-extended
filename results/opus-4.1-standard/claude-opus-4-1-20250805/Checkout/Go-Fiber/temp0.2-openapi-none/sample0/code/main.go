package main

import (
	"database/sql"
	"log"
	"math"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var appSecret string

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "checkout.db?_journal_mode=WAL")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (product_id) REFERENCES products(id))`)
	db.Exec(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, total REAL NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id))`)

	app := fiber.New()

	app.Post("/products", createProduct)
	app.Get("/products", listProducts)
	app.Post("/cart/add", requireAuth, addToCart)
	app.Get("/cart", requireAuth, getCart)
	app.Post("/checkout", requireAuth, checkout)

	log.Fatal(app.Listen(":5000"))
}

func requireAuth(c *fiber.Ctx) error {
	auth := c.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return c.Status(401).JSON(fiber.Map{"error": "Missing token"})
	}
	tokenStr := auth[7:]
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(appSecret), nil
	})
	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
	}
	claims := token.Claims.(jwt.MapClaims)
	c.Locals("user_id", int64(claims["user_id"].(float64)))
	return c.Next()
}

func createProduct(c *fiber.Ctx) error {
	var body struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if body.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name and price required"})
	}
	result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", body.Name, body.Price)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
	}
	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id, "name": body.Name, "price": body.Price})
}

func listProducts(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, price FROM products")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch products"})
	}
	defer rows.Close()
	products := []fiber.Map{}
	for rows.Next() {
		var id int64
		var name string
		var price float64
		rows.Scan(&id, &name, &price)
		products = append(products, fiber.Map{"id": id, "name": name, "price": price})
	}
	return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	var body struct {
		ProductID int64 `json:"product_id"`
		Quantity  int   `json:"quantity"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if body.Quantity <= 0 {
		body.Quantity = 1
	}
	if body.ProductID == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Product ID required"})
	}
	var exists int
	db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", body.ProductID).Scan(&exists)
	if exists == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
	}
	var existingID int64
	err := db.QueryRow("SELECT id FROM cart_items WHERE user_id = ? AND product_id = ?", userID, body.ProductID).Scan(&existingID)
	if err == nil {
		db.Exec("UPDATE cart_items SET quantity = quantity + ? WHERE id = ?", body.Quantity, existingID)
	} else {
		db.Exec("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)", userID, body.ProductID, body.Quantity)
	}
	return c.JSON(fiber.Map{"message": "Added to cart"})
}

func getCart(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	rows, err := db.Query(`SELECT ci.id, ci.product_id, ci.quantity, p.name, p.price
		FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = ?`, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch cart"})
	}
	defer rows.Close()
	items := []fiber.Map{}
	total := 0.0
	for rows.Next() {
		var id, productID int64
		var quantity int
		var name string
		var price float64
		rows.Scan(&id, &productID, &quantity, &name, &price)
		subtotal := math.Round(price*float64(quantity)*100) / 100
		total += subtotal
		items = append(items, fiber.Map{"id": id, "product_id": productID, "name": name, "price": price, "quantity": quantity, "subtotal": subtotal})
	}
	return c.JSON(fiber.Map{"items": items, "total": math.Round(total*100) / 100})
}

func checkout(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	rows, err := db.Query(`SELECT ci.product_id, ci.quantity, p.price FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = ?`, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to process checkout"})
	}
	defer rows.Close()

	type cartItem struct {
		ProductID int64
		Quantity  int
		Price     float64
	}
	var cartItems []cartItem
	total := 0.0
	for rows.Next() {
		var ci cartItem
		rows.Scan(&ci.ProductID, &ci.Quantity, &ci.Price)
		total += ci.Price * float64(ci.Quantity)
		cartItems = append(cartItems, ci)
	}
	if len(cartItems) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
	}
	total = math.Round(total*100) / 100

	tx, _ := db.Begin()
	result, _ := tx.Exec("INSERT INTO orders (user_id, total) VALUES (?, ?)", userID, total)
	orderID, _ := result.LastInsertId()
	for _, ci := range cartItems {
		tx.Exec("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)", orderID, ci.ProductID, ci.Quantity, ci.Price)
	}
	tx.Exec("DELETE FROM cart_items WHERE user_id = ?", userID)
	tx.Commit()

	return c.JSON(fiber.Map{"order_id": orderID, "total": total})
}
