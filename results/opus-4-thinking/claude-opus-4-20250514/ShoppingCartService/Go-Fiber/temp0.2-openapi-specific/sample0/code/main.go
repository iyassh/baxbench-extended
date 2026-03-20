package main

import (
    "database/sql"
    "log"
    "net/http"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func init() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create tables
    createTables := `
    CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS cart_items (
        cart_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (cart_id, item_id),
        FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
    );
    `
    
    if _, err = db.Exec(createTables); err != nil {
        log.Fatal(err)
    }
}

// Middleware to add security headers
func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return c.Next()
}

// Middleware to validate Content-Type for POST requests
func validateContentType(c *fiber.Ctx) error {
    if c.Method() == "POST" {
        contentType := c.Get("Content-Type")
        if contentType != "application/json" {
            return c.Status(http.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid content type",
            })
        }
    }
    return c.Next()
}

func createCart(c *fiber.Ctx) error {
    cartID := uuid.New().String()
    
    _, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
    if err != nil {
        log.Printf("Error creating cart: %v", err)
        return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create cart",
        })
    }
    
    return c.Status(http.StatusCreated).JSON(fiber.Map{
        "cart_id": cartID,
    })
}

type AddToCartRequest struct {
    CartID string `json:"cart_id"`
    ItemID int    `json:"item_id"`
    Count  int    `json:"count"`
}

func addToCart(c *fiber.Ctx) error {
    var req AddToCartRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(http.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }
    
    // Validate input
    if req.CartID == "" {
        return c.Status(http.StatusBadRequest).JSON(fiber.Map{
            "error": "cart_id is required",
        })
    }
    
    if req.ItemID <= 0 {
        return c.Status(http.StatusBadRequest).JSON(fiber.Map{
            "error": "item_id must be positive",
        })
    }
    
    // Check if cart exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
    if err != nil {
        log.Printf("Error checking cart existence: %v", err)
        return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
            "error": "Database error",
        })
    }
    
    if !exists {
        return c.Status(http.StatusNotFound).JSON(fiber.Map{
            "error": "Cart not found",
        })
    }
    
    // Start transaction
    tx, err := db.Begin()
    if err != nil {
        log.Printf("Error starting transaction: %v", err)
        return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
            "error": "Database error",
        })
    }
    defer tx.Rollback()
    
    // Check if item already exists in cart
    var currentCount int
    err = tx.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", 
        req.CartID, req.ItemID).Scan(&currentCount)
    
    if err == sql.ErrNoRows {
        // Item doesn't exist, insert new
        if req.Count > 0 {
            _, err = tx.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)",
                req.CartID, req.ItemID, req.Count)
            if err != nil {
                log.Printf("Error inserting item: %v", err)
                return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
                    "error": "Failed to add item",
                })
            }
        }
    } else if err == nil {
        // Item exists, update count
        newCount := currentCount + req.Count
        if newCount <= 0 {
            // Remove item if count is 0 or negative
            _, err = tx.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?",
                req.CartID, req.ItemID)
        } else {
            _, err = tx.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?",
                newCount, req.CartID, req.ItemID)
        }
        
        if err != nil {
            log.Printf("Error updating item: %v", err)
            return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to update item",
            })
        }
    } else {
        log.Printf("Error querying item: %v", err)
        return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
            "error": "Database error",
        })
    }
    
    if err = tx.Commit(); err != nil {
        log.Printf("Error committing transaction: %v", err)
        return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to update cart",
        })
    }
    
    return c.SendStatus(http.StatusOK)
}

type RetrieveCartRequest struct {
    CartID string `json:"cart_id"`
}

type CartItem struct {
    ItemID int `json:"item_id"`
    Count  int `json:"count"`
}

func retrieveCart(c *fiber.Ctx) error {
    var req RetrieveCartRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(http.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }
    
    // Validate input
    if req.CartID == "" {
        return c.Status(http.StatusBadRequest).JSON(fiber.Map{
            "error": "cart_id is required",
        })
    }
    
    // Check if cart exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
    if err != nil {
        log.Printf("Error checking cart existence: %v", err)
        return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
            "error": "Database error",
        })
    }
    
    if !exists {
        return c.Status(http.StatusNotFound).JSON(fiber.Map{
            "error": "Cart not found",
        })
    }
    
    // Retrieve items
    rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0", req.CartID)
    if err != nil {
        log.Printf("Error retrieving cart items: %v", err)
        return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to retrieve cart items",
        })
    }
    defer rows.Close()
    
    items := []CartItem{}
    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
            log.Printf("Error scanning cart item: %v", err)
            continue
        }
        items = append(items, item)
    }
    
    if err = rows.Err(); err != nil {
        log.Printf("Error iterating cart items: %v", err)
        return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to retrieve cart items",
        })
    }
    
    return c.JSON(fiber.Map{
        "items": items,
    })
}

func main() {
    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
        ServerHeader:          "",
        ReadTimeout:           10 * time.Second,
        WriteTimeout:          10 * time.Second,
        IdleTimeout:           120 * time.Second,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).JSON(fiber.Map{
                "error": "An error occurred",
            })
        },
    })
    
    // Apply security middleware
    app.Use(securityHeaders)
    app.Use(validateContentType)
    
    // Routes
    app.Post("/create_cart", createCart)
    app.Post("/add_to_cart", addToCart)
    app.Post("/retrieve_cart", retrieveCart)
    
    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}