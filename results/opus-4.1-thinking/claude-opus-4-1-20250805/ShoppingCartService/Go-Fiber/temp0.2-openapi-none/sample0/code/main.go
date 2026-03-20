package main

import (
    "database/sql"
    "log"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create tables
    createCartsTable := `
    CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY
    );`
    
    _, err = db.Exec(createCartsTable)
    if err != nil {
        log.Fatal(err)
    }
    
    createItemsTable := `
    CREATE TABLE IF NOT EXISTS cart_items (
        cart_id TEXT,
        item_id INTEGER,
        count INTEGER,
        PRIMARY KEY (cart_id, item_id),
        FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
    );`
    
    _, err = db.Exec(createItemsTable)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    app.Post("/create_cart", createCart)
    app.Post("/add_to_cart", addToCart)
    app.Post("/retrieve_cart", retrieveCart)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createCart(c *fiber.Ctx) error {
    cartID := uuid.New().String()
    
    _, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create cart"})
    }
    
    return c.Status(201).JSON(fiber.Map{
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
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }
    
    // Check if cart exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    if !exists {
        return c.Status(404).JSON(fiber.Map{"error": "Cart not found"})
    }
    
    // Get current count if item exists
    var currentCount int
    err = db.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID).Scan(&currentCount)
    if err != nil && err != sql.ErrNoRows {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    
    newCount := currentCount + req.Count
    
    if newCount <= 0 {
        // Remove item from cart if count becomes 0 or negative
        _, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to remove item"})
        }
    } else {
        // Check if item exists in cart
        if err == sql.ErrNoRows {
            // Item doesn't exist, insert new
            _, err = db.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", 
                req.CartID, req.ItemID, newCount)
        } else {
            // Item exists, update count
            _, err = db.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?",
                newCount, req.CartID, req.ItemID)
        }
        
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to update cart"})
        }
    }
    
    return c.SendStatus(200)
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
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }
    
    // Check if cart exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    if !exists {
        return c.Status(404).JSON(fiber.Map{"error": "Cart not found"})
    }
    
    // Get all items in the cart
    rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    defer rows.Close()
    
    items := []CartItem{}
    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
            continue
        }
        items = append(items, item)
    }
    
    return c.JSON(fiber.Map{
        "items": items,
    })
}