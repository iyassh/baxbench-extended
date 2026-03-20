package main

import (
    "database/sql"
    "log"
    
    "github.com/gofiber/fiber/v2"
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

func init() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create tables
    createTablesQuery := `
    CREATE TABLE IF NOT EXISTS carts (
        cart_id TEXT PRIMARY KEY
    );
    
    CREATE TABLE IF NOT EXISTS cart_items (
        cart_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (cart_id, item_id),
        FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
    );
    `
    
    _, err = db.Exec(createTablesQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    app := fiber.New()
    
    // Create cart endpoint
    app.Post("/create_cart", createCart)
    
    // Add to cart endpoint
    app.Post("/add_to_cart", addToCart)
    
    // Retrieve cart endpoint
    app.Post("/retrieve_cart", retrieveCart)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createCart(c *fiber.Ctx) error {
    cartID := uuid.New().String()
    
    _, err := db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).SendString("Failed to create cart")
    }
    
    return c.Status(fiber.StatusCreated).JSON(CreateCartResponse{
        CartID: cartID,
    })
}

func addToCart(c *fiber.Ctx) error {
    var req AddToCartRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid request")
    }
    
    // Check if cart exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
    if err != nil || !exists {
        return c.Status(fiber.StatusNotFound).SendString("Cart not found")
    }
    
    // Check if item already exists in cart
    var currentCount int
    err = db.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID).Scan(&currentCount)
    
    if err == sql.ErrNoRows {
        // Item doesn't exist in cart
        if req.Count > 0 {
            _, err = db.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", req.CartID, req.ItemID, req.Count)
            if err != nil {
                return c.Status(fiber.StatusInternalServerError).SendString("Failed to add item to cart")
            }
        }
        // If count is negative or zero and item doesn't exist, do nothing
    } else if err == nil {
        // Item exists, update count
        newCount := currentCount + req.Count
        if newCount <= 0 {
            // Remove item from cart
            _, err = db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", req.CartID, req.ItemID)
        } else {
            // Update item count
            _, err = db.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?", newCount, req.CartID, req.ItemID)
        }
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to update cart")
        }
    } else {
        return c.Status(fiber.StatusInternalServerError).SendString("Database error")
    }
    
    return c.SendStatus(fiber.StatusOK)
}

func retrieveCart(c *fiber.Ctx) error {
    var req RetrieveCartRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid request")
    }
    
    // Check if cart exists
    var exists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM carts WHERE cart_id = ?)", req.CartID).Scan(&exists)
    if err != nil || !exists {
        return c.Status(fiber.StatusNotFound).SendString("Cart not found")
    }
    
    // Get items from cart
    rows, err := db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).SendString("Failed to retrieve cart")
    }
    defer rows.Close()
    
    items := []CartItem{}
    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to scan items")
        }
        items = append(items, item)
    }
    
    return c.JSON(RetrieveCartResponse{
        Items: items,
    })
}