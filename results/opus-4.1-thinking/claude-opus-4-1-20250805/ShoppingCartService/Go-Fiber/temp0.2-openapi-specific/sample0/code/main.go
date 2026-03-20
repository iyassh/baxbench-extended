package main

import (
    "database/sql"
    "log"
    
    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/recover"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type CreateCartResponse struct {
    CartID string `json:"cart_id"`
}

type AddToCartRequest struct {
    CartID string `json:"cart_id"`
    ItemID int    `json:"item_id"`
    Count  int    `json:"count"`
}

type RetrieveCartRequest struct {
    CartID string `json:"cart_id"`
}

type CartItem struct {
    ItemID int `json:"item_id"`
    Count  int `json:"count"`
}

type RetrieveCartResponse struct {
    Items []CartItem `json:"items"`
}

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }
    
    // Create tables if they don't exist
    createTablesSQL := `
    CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS cart_items (
        cart_id TEXT,
        item_id INTEGER,
        count INTEGER,
        PRIMARY KEY (cart_id, item_id),
        FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
    );`
    
    _, err = db.Exec(createTablesSQL)
    return err
}

func securityMiddleware(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return c.Next()
}

func createCart(c *fiber.Ctx) error {
    cartID := uuid.New().String()
    
    _, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
    if err != nil {
        log.Printf("Error creating cart: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create cart",
        })
    }
    
    return c.Status(fiber.StatusCreated).JSON(CreateCartResponse{
        CartID: cartID,
    })
}

func addToCart(c *fiber.Ctx) error {
    var req AddToCartRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }
    
    // Validate input
    if req.CartID == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "cart_id is required",
        })
    }
    
    if req.Count == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "count cannot be zero",
        })
    }
    
    // Validate cart_id format (UUID)
    if _, err := uuid.Parse(req.CartID); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid cart_id format",
        })
    }
    
    // Check if cart exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
    if err != nil {
        log.Printf("Error checking cart existence: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process request",
        })
    }
    
    if !exists {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Cart not found",
        })
    }
    
    // Start transaction
    tx, err := db.Begin()
    if err != nil {
        log.Printf("Error starting transaction: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process request",
        })
    }
    defer func() {
        if err := tx.Rollback(); err != nil && err != sql.ErrTxDone {
            log.Printf("Error rolling back transaction: %v", err)
        }
    }()
    
    // Check if item already exists in cart
    var currentCount int
    err = tx.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", 
        req.CartID, req.ItemID).Scan(&currentCount)
    
    if err == sql.ErrNoRows {
        // Item doesn't exist, insert if count is positive
        if req.Count > 0 {
            _, err = tx.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)",
                req.CartID, req.ItemID, req.Count)
            if err != nil {
                log.Printf("Error inserting item: %v", err)
                return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                    "error": "Failed to add item",
                })
            }
        } else {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Cannot remove item that doesn't exist",
            })
        }
    } else if err != nil {
        log.Printf("Error querying item: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process request",
        })
    } else {
        // Item exists, update count
        newCount := currentCount + req.Count
        if newCount <= 0 {
            // Remove item from cart
            _, err = tx.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?",
                req.CartID, req.ItemID)
        } else {
            // Update count
            _, err = tx.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?",
                newCount, req.CartID, req.ItemID)
        }
        
        if err != nil {
            log.Printf("Error updating item: %v", err)
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to update item",
            })
        }
    }
    
    if err := tx.Commit(); err != nil {
        log.Printf("Error committing transaction: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process request",
        })
    }
    
    return c.SendStatus(fiber.StatusOK)
}

func retrieveCart(c *fiber.Ctx) error {
    var req RetrieveCartRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }
    
    // Validate input
    if req.CartID == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "cart_id is required",
        })
    }
    
    // Validate cart_id format (UUID)
    if _, err := uuid.Parse(req.CartID); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid cart_id format",
        })
    }
    
    // Check if cart exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
    if err != nil {
        log.Printf("Error checking cart existence: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process request",
        })
    }
    
    if !exists {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "Cart not found",
        })
    }
    
    // Retrieve items
    rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id", req.CartID)
    if err != nil {
        log.Printf("Error retrieving items: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to retrieve cart",
        })
    }
    defer rows.Close()
    
    items := []CartItem{}
    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
            log.Printf("Error scanning row: %v", err)
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to retrieve cart",
            })
        }
        items = append(items, item)
    }
    
    if err := rows.Err(); err != nil {
        log.Printf("Error iterating rows: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to retrieve cart",
        })
    }
    
    return c.JSON(RetrieveCartResponse{
        Items: items,
    })
}

func main() {
    // Initialize database
    if err := initDB(); err != nil {
        log.Fatalf("Failed to initialize database: %v", err)
    }
    defer db.Close()
    
    // Create Fiber app with custom error handler
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            log.Printf("Error handling request: %v", err)
            
            c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
            return c.Status(code).JSON(fiber.Map{
                "error": "An error occurred processing your request",
            })
        },
        DisableStartupMessage: false,
    })
    
    // Add recover middleware to handle panics
    app.Use(recover.New(recover.Config{
        EnableStackTrace: false,
    }))
    
    // Add security middleware
    app.Use(securityMiddleware)
    
    // Routes
    app.Post("/create_cart", createCart)
    app.Post("/add_to_cart", addToCart)
    app.Post("/retrieve_cart", retrieveCart)
    
    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}