package main

import (
    "database/sql"
    "log"
    "sync"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/logger"
    "github.com/gofiber/fiber/v2/middleware/recover"
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

var (
    db   *sql.DB
    cart = make(map[int]int)
    mu   sync.RWMutex
)

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL CHECK(price >= 0)
        )
    `)
    if err != nil {
        return err
    }

    return nil
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.Next()
}

func createProduct(c *fiber.Ctx) error {
    var req CreateProductRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request format"})
    }

    if req.Name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Product name is required"})
    }
    if req.Price < 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Price must be non-negative"})
    }

    result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    id, err := result.LastInsertId()
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
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
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer rows.Close()

    products := []Product{}
    for rows.Next() {
        var p Product
        err := rows.Scan(&p.ID, &p.Name, &p.Price)
        if err != nil {
            log.Printf("Database error: %v", err)
            return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
        }
        products = append(products, p)
    }

    if err = rows.Err(); err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
    var req AddToCartRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request format"})
    }

    if req.Quantity <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Quantity must be positive"})
    }

    var exists int
    err := db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", req.ProductID).Scan(&exists)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    if exists == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
    }

    mu.Lock()
    cart[req.ProductID] += req.Quantity
    mu.Unlock()

    return c.JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
    mu.RLock()
    defer mu.RUnlock()

    items := []CartItem{}
    var total float64

    for productID, quantity := range cart {
        if quantity <= 0 {
            continue
        }

        var name string
        var price float64
        err := db.QueryRow("SELECT name, price FROM products WHERE id = ?", productID).Scan(&name, &price)
        if err != nil {
            if err == sql.ErrNoRows {
                continue
            }
            log.Printf("Database error: %v", err)
            return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
        }

        items = append(items, CartItem{
            ProductID: productID,
            Name:      name,
            Price:     price,
            Quantity:  quantity,
        })
        total += price * float64(quantity)
    }

    return c.JSON(CartResponse{
        Items: items,
        Total: total,
    })
}

func checkout(c *fiber.Ctx) error {
    mu.Lock()
    defer mu.Unlock()

    if len(cart) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
    }

    var total float64
    hasValidItems := false

    for productID, quantity := range cart {
        if quantity <= 0 {
            continue
        }

        var price float64
        err := db.QueryRow("SELECT price FROM products WHERE id = ?", productID).Scan(&price)
        if err != nil {
            if err == sql.ErrNoRows {
                continue
            }
            log.Printf("Database error: %v", err)
            return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
        }

        hasValidItems = true
        total += price * float64(quantity)
    }

    if !hasValidItems || total <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid cart"})
    }

    cart = make(map[int]int)

    return c.JSON(fiber.Map{
        "message": "Order confirmed",
        "total":   total,
    })
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            message := "Internal server error"
            if code >= 400 && code < 500 {
                message = "Bad request"
            }
            
            return c.Status(code).JSON(fiber.Map{
                "error": message,
            })
        },
        DisableStartupMessage: false,
    })

    app.Use(recover.New(recover.Config{
        EnableStackTrace: false,
    }))
    app.Use(logger.New())
    app.Use(securityHeaders)

    app.Post("/products", createProduct)
    app.Get("/products", listProducts)
    app.Post("/cart/add", addToCart)
    app.Get("/cart", getCart)
    app.Post("/checkout", checkout)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}