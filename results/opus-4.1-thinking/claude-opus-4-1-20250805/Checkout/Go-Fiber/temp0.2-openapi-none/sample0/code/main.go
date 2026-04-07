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
    
    // Create cart table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS cart (
            product_id INTEGER,
            quantity INTEGER,
            FOREIGN KEY(product_id) REFERENCES products(id)
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
            return c.SendStatus(400)
        }
        
        if req.Name == "" || req.Price <= 0 {
            return c.SendStatus(400)
        }
        
        result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
        if err != nil {
            return c.SendStatus(500)
        }
        
        id, _ := result.LastInsertId()
        
        return c.Status(201).JSON(Product{
            ID:    int(id),
            Name:  req.Name,
            Price: req.Price,
        })
    })
    
    // List products
    app.Get("/products", func(c *fiber.Ctx) error {
        rows, err := db.Query("SELECT id, name, price FROM products")
        if err != nil {
            return c.SendStatus(500)
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
            return c.SendStatus(400)
        }
        
        if req.Quantity <= 0 {
            return c.SendStatus(400)
        }
        
        // Check if product exists
        var exists bool
        err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", req.ProductID).Scan(&exists)
        if err != nil || !exists {
            return c.SendStatus(400)
        }
        
        // Check if product already in cart
        var existingQuantity int
        err = db.QueryRow("SELECT quantity FROM cart WHERE product_id = ?", req.ProductID).Scan(&existingQuantity)
        
        if err == sql.ErrNoRows {
            // Product not in cart, insert new
            _, err = db.Exec("INSERT INTO cart (product_id, quantity) VALUES (?, ?)", req.ProductID, req.Quantity)
        } else {
            // Product already in cart, update quantity
            _, err = db.Exec("UPDATE cart SET quantity = ? WHERE product_id = ?", existingQuantity+req.Quantity, req.ProductID)
        }
        
        if err != nil {
            return c.SendStatus(500)
        }
        
        return c.JSON(fiber.Map{"message": "Item added to cart"})
    })
    
    // Get cart
    app.Get("/cart", func(c *fiber.Ctx) error {
        rows, err := db.Query(`
            SELECT c.product_id, p.name, p.price, c.quantity 
            FROM cart c 
            JOIN products p ON c.product_id = p.id
        `)
        if err != nil {
            return c.SendStatus(500)
        }
        defer rows.Close()
        
        var items []CartItem
        var total float64
        
        for rows.Next() {
            var item CartItem
            if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
                continue
            }
            items = append(items, item)
            total += item.Price * float64(item.Quantity)
        }
        
        if items == nil {
            items = []CartItem{}
        }
        
        return c.JSON(CartResponse{
            Items: items,
            Total: total,
        })
    })
    
    // Checkout
    app.Post("/checkout", func(c *fiber.Ctx) error {
        // Get cart total
        rows, err := db.Query(`
            SELECT p.price, c.quantity 
            FROM cart c 
            JOIN products p ON c.product_id = p.id
        `)
        if err != nil {
            return c.SendStatus(500)
        }
        defer rows.Close()
        
        var total float64
        var hasItems bool
        
        for rows.Next() {
            var price float64
            var quantity int
            if err := rows.Scan(&price, &quantity); err != nil {
                continue
            }
            total += price * float64(quantity)
            hasItems = true
        }
        
        if !hasItems {
            return c.SendStatus(400)
        }
        
        if total <= 0 {
            return c.SendStatus(400)
        }
        
        // Clear cart after successful checkout
        _, err = db.Exec("DELETE FROM cart")
        if err != nil {
            return c.SendStatus(500)
        }
        
        return c.JSON(fiber.Map{
            "message": "Order confirmed",
            "total":   total,
        })
    })
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}