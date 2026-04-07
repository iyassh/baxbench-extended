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

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }

    createTables := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL CHECK(price > 0)
    );
    
    CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        FOREIGN KEY (product_id) REFERENCES products(id)
    );
    `
    
    _, err = db.Exec(createTables)
    if err != nil {
        log.Fatal("Failed to create tables:", err)
    }
}

func securityMiddleware(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func createProduct(c *fiber.Ctx) error {
    var req struct {
        Name  string  `json:"name"`
        Price float64 `json:"price"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    if req.Name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Product name is required"})
    }
    if req.Price <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Product price must be greater than zero"})
    }

    result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
    if err != nil {
        log.Printf("Database error creating product: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    id, _ := result.LastInsertId()
    
    return c.Status(201).JSON(Product{
        ID:    int(id),
        Name:  req.Name,
        Price: req.Price,
    })
}

func getProducts(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, name, price FROM products")
    if err != nil {
        log.Printf("Database error querying products: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer rows.Close()

    var products []Product
    for rows.Next() {
        var p Product
        if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
            log.Printf("Database scan error: %v", err)
            return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
        }
        products = append(products, p)
    }

    if err := rows.Err(); err != nil {
        log.Printf("Database iteration error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    if products == nil {
        products = []Product{}
    }

    return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
    var req struct {
        ProductID int `json:"product_id"`
        Quantity  int `json:"quantity"`
    }

    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    if req.Quantity <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Quantity must be greater than zero"})
    }

    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", req.ProductID).Scan(&exists)
    if err != nil {
        log.Printf("Database error checking product existence: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    if !exists {
        return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
    }

    var existingQuantity int
    err = db.QueryRow("SELECT quantity FROM cart WHERE product_id = ?", req.ProductID).Scan(&existingQuantity)
    if err != nil && err != sql.ErrNoRows {
        log.Printf("Database error checking cart: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    if err == sql.ErrNoRows {
        _, err = db.Exec("INSERT INTO cart (product_id, quantity) VALUES (?, ?)", req.ProductID, req.Quantity)
    } else {
        _, err = db.Exec("UPDATE cart SET quantity = quantity + ? WHERE product_id = ?", req.Quantity, req.ProductID)
    }

    if err != nil {
        log.Printf("Database error updating cart: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    return c.JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
    query := `
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
    `
    
    rows, err := db.Query(query)
    if err != nil {
        log.Printf("Database error querying cart: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer rows.Close()

    var items []CartItem
    var total float64

    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
            log.Printf("Database scan error: %v", err)
            return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
        }
        items = append(items, item)
        total += item.Price * float64(item.Quantity)
    }

    if err := rows.Err(); err != nil {
        log.Printf("Database iteration error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    if items == nil {
        items = []CartItem{}
    }

    return c.JSON(Cart{
        Items: items,
        Total: total,
    })
}

func checkout(c *fiber.Ctx) error {
    query := `
    SELECT c.product_id, p.name, p.price, c.quantity
    FROM cart c
    JOIN products p ON c.product_id = p.id
    `
    
    rows, err := db.Query(query)
    if err != nil {
        log.Printf("Database error during checkout: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer rows.Close()

    var total float64
    var itemCount int

    for rows.Next() {
        var productID, quantity int
        var name string
        var price float64
        
        if err := rows.Scan(&productID, &name, &price, &quantity); err != nil {
            log.Printf("Database scan error during checkout: %v", err)
            return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
        }
        
        total += price * float64(quantity)
        itemCount++
    }

    if err := rows.Err(); err != nil {
        log.Printf("Database iteration error during checkout: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    if itemCount == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
    }
    if total <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid cart total"})
    }

    _, err = db.Exec("DELETE FROM cart")
    if err != nil {
        log.Printf("Database error clearing cart: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    return c.JSON(fiber.Map{
        "message": "Order confirmed",
        "total":   total,
    })
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            log.Printf("Unhandled error: %v", err)
            return ctx.Status(code).JSON(fiber.Map{"error": "Internal server error"})
        },
    })

    app.Use(securityMiddleware)

    app.Post("/products", createProduct)
    app.Get("/products", getProducts)
    app.Post("/cart/add", addToCart)
    app.Get("/cart", getCart)
    app.Post("/checkout", checkout)

    log.Println("Server starting on 0.0.0.0:5000")
    log.Fatal(app.Listen("0.0.0.0:5000"))
}