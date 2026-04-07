package main

import (
    "database/sql"
    "log"
    "sync"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var cart = make(map[int]int) // product_id -> quantity
var cartMutex sync.Mutex

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

type CartResponse struct {
    Items []CartItem `json:"items"`
    Total float64    `json:"total"`
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL
    );`
    
    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    // POST /products
    app.Post("/products", func(c *fiber.Ctx) error {
        var product struct {
            Name  string  `json:"name"`
            Price float64 `json:"price"`
        }
        
        if err := c.BodyParser(&product); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
        }
        
        if product.Name == "" || product.Price <= 0 {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid product data"})
        }
        
        result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", product.Name, product.Price)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }
        
        id, _ := result.LastInsertId()
        
        return c.Status(201).JSON(Product{
            ID:    int(id),
            Name:  product.Name,
            Price: product.Price,
        })
    })
    
    // GET /products
    app.Get("/products", func(c *fiber.Ctx) error {
        rows, err := db.Query("SELECT id, name, price FROM products")
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }
        defer rows.Close()
        
        var products []Product
        for rows.Next() {
            var p Product
            if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
                continue
            }
            products = append(products, p)
        }
        
        if products == nil {
            products = []Product{}
        }
        
        return c.JSON(products)
    })
    
    // POST /cart/add
    app.Post("/cart/add", func(c *fiber.Ctx) error {
        var item struct {
            ProductID int `json:"product_id"`
            Quantity  int `json:"quantity"`
        }
        
        if err := c.BodyParser(&item); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
        }
        
        if item.Quantity <= 0 {
            return c.Status(400).JSON(fiber.Map{"error": "Quantity must be positive"})
        }
        
        // Check if product exists
        var exists bool
        err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", item.ProductID).Scan(&exists)
        if err != nil || !exists {
            return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
        }
        
        cartMutex.Lock()
        cart[item.ProductID] += item.Quantity
        cartMutex.Unlock()
        
        return c.JSON(fiber.Map{"message": "Item added to cart"})
    })
    
    // GET /cart
    app.Get("/cart", func(c *fiber.Ctx) error {
        cartMutex.Lock()
        defer cartMutex.Unlock()
        
        var items []CartItem
        var total float64
        
        for productID, quantity := range cart {
            var item CartItem
            err := db.QueryRow("SELECT id, name, price FROM products WHERE id = ?", productID).Scan(
                &item.ProductID, &item.Name, &item.Price,
            )
            if err != nil {
                continue
            }
            item.Quantity = quantity
            items = append(items, item)
            total += item.Price * float64(quantity)
        }
        
        if items == nil {
            items = []CartItem{}
        }
        
        return c.JSON(CartResponse{
            Items: items,
            Total: total,
        })
    })
    
    // POST /checkout
    app.Post("/checkout", func(c *fiber.Ctx) error {
        cartMutex.Lock()
        defer cartMutex.Unlock()
        
        if len(cart) == 0 {
            return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
        }
        
        var total float64
        for productID, quantity := range cart {
            var price float64
            err := db.QueryRow("SELECT price FROM products WHERE id = ?", productID).Scan(&price)
            if err != nil {
                continue
            }
            total += price * float64(quantity)
        }
        
        if total <= 0 {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid cart total"})
        }
        
        // Clear cart after checkout
        cart = make(map[int]int)
        
        return c.JSON(fiber.Map{
            "message": "Order confirmed",
            "total":   total,
        })
    })
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}