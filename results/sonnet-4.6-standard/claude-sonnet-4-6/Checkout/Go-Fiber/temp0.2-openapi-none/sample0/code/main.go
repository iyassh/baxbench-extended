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

	app := fiber.New()

	// POST /products - Create a product
	app.Post("/products", func(c *fiber.Ctx) error {
		var body struct {
			Name  string  `json:"name"`
			Price float64 `json:"price"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if body.Name == "" || body.Price <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Name and positive price are required"})
		}

		result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", body.Name, body.Price)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
		}
		id, _ := result.LastInsertId()
		return c.Status(201).JSON(fiber.Map{
			"id":    id,
			"name":  body.Name,
			"price": body.Price,
		})
	})

	// GET /products - List all products
	app.Get("/products", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, name, price FROM products")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch products"})
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
				return c.Status(500).JSON(fiber.Map{"error": "Failed to scan product"})
			}
			products = append(products, p)
		}
		return c.JSON(products)
	})

	// POST /cart/add - Add item to cart
	app.Post("/cart/add", func(c *fiber.Ctx) error {
		var body struct {
			ProductID int `json:"product_id"`
			Quantity  int `json:"quantity"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if body.ProductID <= 0 || body.Quantity <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "product_id and positive quantity are required"})
		}

		// Check product exists
		var count int
		err := db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", body.ProductID).Scan(&count)
		if err != nil || count == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
		}

		// Check if product already in cart
		var cartID int
		var existingQty int
		err = db.QueryRow("SELECT id, quantity FROM cart WHERE product_id = ?", body.ProductID).Scan(&cartID, &existingQty)
		if err == sql.ErrNoRows {
			// Insert new cart item
			_, err = db.Exec("INSERT INTO cart (product_id, quantity) VALUES (?, ?)", body.ProductID, body.Quantity)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to add item to cart"})
			}
		} else if err == nil {
			// Update existing cart item
			_, err = db.Exec("UPDATE cart SET quantity = ? WHERE id = ?", existingQty+body.Quantity, cartID)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to update cart item"})
			}
		} else {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to query cart"})
		}

		return c.JSON(fiber.Map{"message": "Item added to cart"})
	})

	// GET /cart - Get cart contents
	app.Get("/cart", func(c *fiber.Ctx) error {
		rows, err := db.Query(`
			SELECT c.product_id, p.name, p.price, c.quantity
			FROM cart c
			JOIN products p ON c.product_id = p.id
		`)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch cart"})
		}
		defer rows.Close()

		type CartItem struct {
			ProductID int     `json:"product_id"`
			Name      string  `json:"name"`
			Price     float64 `json:"price"`
			Quantity  int     `json:"quantity"`
		}

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

		return c.JSON(fiber.Map{
			"items": items,
			"total": total,
		})
	})

	// POST /checkout - Process checkout
	app.Post("/checkout", func(c *fiber.Ctx) error {
		rows, err := db.Query(`
			SELECT c.product_id, p.price, c.quantity
			FROM cart c
			JOIN products p ON c.product_id = p.id
		`)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch cart"})
		}
		defer rows.Close()

		total := 0.0
		count := 0
		for rows.Next() {
			var productID, quantity int
			var price float64
			if err := rows.Scan(&productID, &price, &quantity); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to scan cart item"})
			}
			total += price * float64(quantity)
			count++
		}

		if count == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
		}
		if total <= 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid total"})
		}

		// Clear the cart after checkout
		if _, err := db.Exec("DELETE FROM cart"); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to clear cart"})
		}

		return c.JSON(fiber.Map{
			"message": "Order confirmed",
			"total":   total,
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}