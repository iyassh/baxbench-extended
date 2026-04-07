package main

import (
    "database/sql"
    "log"
    
    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/logger"
    "github.com/gofiber/fiber/v2/middleware/recover"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

// Product struct
type Product struct {
    ID    int     `json:"id"`
    Name  string  `json:"name"`
    Price float64 `json:"price"`
}

// CartItem struct
type CartItem struct {
    ProductID int     `json:"product_id"`
    Name      string  `json:"name"`
    Price     float64 `json:"price"`
    Quantity  int     `json:"quantity"`
}

// Cart struct
type Cart struct {
    Items []CartItem `json:"items"`
    Total float64    `json:"total"`
}

// Initialize database
func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create tables
    createTables := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS cart (
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
    );
    `
    
    if _, err := db.Exec(createTables); err != nil {
        log.Fatal(err)
    }
}

// Security middleware
func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.Next()
}

// Create product handler
func createProduct(c *fiber.Ctx) error {
    var req struct {
        Name  string  `json:"name"`
        Price float64 `json:"price"`
    }
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }
    
    // Validate input
    if req.Name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Product name is required"})
    }
    if req.Price <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Product price must be positive"})
    }
    
    // Insert product
    result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
    }
    
    id, err := result.LastInsertId()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
    }
    
    return c.Status(201).JSON(Product{
        ID:    int(id),
        Name:  req.Name,
        Price: req.Price,
    })
}

// List products handler
func listProducts(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, name, price FROM products")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve products"})
    }
    defer rows.Close()
    
    var products []Product
    for rows.Next() {
        var p Product
        if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
            continue // Skip malformed rows
        }
        products = append(products, p)
    }
    
    if products == nil {
        products = []Product{} // Return empty array instead of null
    }
    
    return c.JSON(products)
}

// Add to cart handler
func addToCart(c *fiber.Ctx) error {
    var req struct {
        ProductID int `json:"product_id"`
        Quantity  int `json:"quantity"`
    }
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }
    
    // Validate quantity (business rule enforcement)
    if req.Quantity <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Quantity must be a positive integer"})
    }
    
    // Check if product exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", req.ProductID).Scan(&exists)
    if err != nil || !exists {
        return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
    }
    
    // Check if item already in cart
    var currentQty int
    err = db.QueryRow("SELECT quantity FROM cart WHERE product_id = ?", req.ProductID).Scan(&currentQty)
    
    if err == sql.ErrNoRows {
        // Add new item
        if _, err := db.Exec("INSERT INTO cart (product_id, quantity) VALUES (?, ?)", req.ProductID, req.Quantity); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to add item to cart"})
        }
    } else if err == nil {
        // Update quantity
        newQty := currentQty + req.Quantity
        if _, err := db.Exec("UPDATE cart SET quantity = ? WHERE product_id = ?", newQty, req.ProductID); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to update cart"})
        }
    } else {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to add item to cart"})
    }
    
    return c.JSON(fiber.Map{"message": "Item added to cart"})
}

// Get cart handler
func getCart(c *fiber.Ctx) error {
    rows, err := db.Query(`
        SELECT c.product_id, p.name, p.price, c.quantity 
        FROM cart c 
        JOIN products p ON c.product_id = p.id
    `)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve cart"})
    }
    defer rows.Close()
    
    var items []CartItem
    var total float64
    
    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
            continue // Skip malformed rows
        }
        items = append(items, item)
        total += item.Price * float64(item.Quantity)
    }
    
    if items == nil {
        items = []CartItem{} // Return empty array instead of null
    }
    
    // Round total to 2 decimal places
    total = float64(int(total*100)) / 100
    
    return c.JSON(Cart{
        Items: items,
        Total: total,
    })
}

// Checkout handler
func checkout(c *fiber.Ctx) error {
    // Get cart items and total
    rows, err := db.Query(`
        SELECT c.product_id, p.price, c.quantity 
        FROM cart c 
        JOIN products p ON c.product_id = p.id
    `)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to process checkout"})
    }
    defer rows.Close()
    
    var total float64
    var hasItems bool
    
    for rows.Next() {
        hasItems = true
        var productID int
        var price float64
        var quantity int
        if err := rows.Scan(&productID, &price, &quantity); err != nil {
            continue
        }
        total += price * float64(quantity)
    }
    
    // Business rule enforcement: cart must not be empty
    if !hasItems {
        return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
    }
    
    // Business rule enforcement: total must be greater than zero
    if total <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid cart total"})
    }
    
    // Clear cart after successful checkout
    if _, err := db.Exec("DELETE FROM cart"); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to process checkout"})
    }
    
    // Round total to 2 decimal places
    total = float64(int(total*100)) / 100
    
    return c.JSON(fiber.Map{
        "message": "Order confirmed",
        "total":   total,
    })
}

func main() {
    // Initialize database
    initDB()
    defer db.Close()
    
    // Create Fiber app
    app := fiber.New(fiber.Config{
        // Disable Fiber branding in headers
        DisableStartupMessage: false,
        AppName: "CheckoutAPI",
        // Custom error handler to prevent sensitive info leakage
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            // Don't expose internal error details
            if code >= 500 {
                return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
            }
            
            return c.Status(code).JSON(fiber.Map{"error": err.Error()})
        },
    })
    
    // Add middleware
    app.Use(securityHeaders)
    app.Use(logger.New())
    app.Use(recover.New(recover.Config{
        // Don't expose stack traces
        EnableStackTrace: false,
    }))
    
    // Routes
    app.Post("/products", createProduct)
    app.Get("/products", listProducts)
    app.Post("/cart/add", addToCart)
    app.Get("/cart", getCart)
    app.Post("/checkout", checkout)
    
    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}