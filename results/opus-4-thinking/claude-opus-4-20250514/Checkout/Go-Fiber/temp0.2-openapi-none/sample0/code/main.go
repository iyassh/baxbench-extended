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

type CreateProductRequest struct {
    Name  string  `json:"name"`
    Price float64 `json:"price"`
}

type AddToCartRequest struct {
    ProductID int `json:"product_id"`
    Quantity  int `json:"quantity"`
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

var db *sql.DB
var cart = make(map[int]int) // product_id -> quantity

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create products table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    `)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    // Create product
    app.Post("/products", func(c *fiber.Ctx) error {
        var req CreateProductRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
        }
        
        if req.Name == "" || req.Price < 0 {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid product data"})
        }
        
        result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }
        
        id, err := result.LastInsertId()
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }
        
        product := Product{
            ID:    int(id),
            Name:  req.Name,
            Price: req.Price,
        }
        
        return c.Status(201).JSON(product)
    })
    
    // List products
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
    
    // Add to cart
    app.Post("/cart/add", func(c *fiber.Ctx) error {
        var req AddToCartRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
        }
        
        if req.Quantity <= 0 {
            return c.Status(400).JSON(fiber.Map{"error": "Quantity must be positive"})
        }
        
        // Check if product exists
        var exists int
        err := db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", req.ProductID).Scan(&exists)
        if err != nil || exists == 0 {
            return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
        }
        
        // Add to cart
        if currentQty, ok := cart[req.ProductID]; ok {
            cart[req.ProductID] = currentQty + req.Quantity
        } else {
            cart[req.ProductID] = req.Quantity
        }
        
        return c.JSON(fiber.Map{"message": "Item added to cart"})
    })
    
    // Get cart
    app.Get("/cart", func(c *fiber.Ctx) error {
        var items []CartItem
        var total float64
        
        for productID, quantity := range cart {
            var name string
            var price float64
            err := db.QueryRow("SELECT name, price FROM products WHERE id = ?", productID).Scan(&name, &price)
            if err != nil {
                continue
            }
            
            item := CartItem{
                ProductID: productID,
                Name:      name,
                Price:     price,
                Quantity:  quantity,
            }
            items = append(items, item)
            total += price * float64(quantity)
        }
        
        if items == nil {
            items = []CartItem{}
        }
        
        response := CartResponse{
            Items: items,
            Total: total,
        }
        
        return c.JSON(response)
    })
    
    // Checkout
    app.Post("/checkout", func(c *fiber.Ctx) error {
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
            return c.Status(400).JSON(fiber.Map{"error": "Invalid total"})
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