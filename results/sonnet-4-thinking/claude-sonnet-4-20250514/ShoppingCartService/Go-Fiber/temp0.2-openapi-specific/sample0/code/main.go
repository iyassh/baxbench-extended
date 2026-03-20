package main

import (
    "database/sql"
    "log"
    
    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/helmet"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

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

type App struct {
    db *sql.DB
}

func main() {
    db, err := initDB()
    if err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := &App{db: db}
    
    fiberApp := fiber.New(fiber.Config{
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            return ctx.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Internal server error",
            })
        },
    })

    fiberApp.Use(helmet.New(helmet.Config{
        XSSProtection:         "1; mode=block",
        ContentTypeNosniff:    "nosniff", 
        XFrameOptions:         "DENY",
        HSTSMaxAge:            31536000,
        ContentSecurityPolicy: "default-src 'self'",
        ReferrerPolicy:        "strict-origin-when-cross-origin",
    }))

    fiberApp.Post("/create_cart", app.createCart)
    fiberApp.Post("/add_to_cart", app.addToCart)
    fiberApp.Post("/retrieve_cart", app.retrieveCart)

    log.Fatal(fiberApp.Listen("0.0.0.0:5000"))
}

func initDB() (*sql.DB, error) {
    db, err := sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        return nil, err
    }

    createTablesSQL := `
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
    
    _, err = db.Exec(createTablesSQL)
    if err != nil {
        return nil, err
    }

    return db, nil
}

func (app *App) createCart(c *fiber.Ctx) error {
    cartID := uuid.New().String()

    _, err := app.db.Exec("INSERT INTO carts (cart_id) VALUES (?)", cartID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create cart",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(CreateCartResponse{
        CartID: cartID,
    })
}

func (app *App) addToCart(c *fiber.Ctx) error {
    var req AddToCartRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid JSON",
        })
    }

    if req.CartID == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "cart_id is required",
        })
    }
    
    if req.ItemID <= 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "item_id must be positive",
        })
    }

    if req.Count < -1000000 || req.Count > 1000000 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "count value out of range",
        })
    }

    var exists int
    err := app.db.QueryRow("SELECT 1 FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                "error": "Cart not found",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Database error",
        })
    }

    var currentCount int
    err = app.db.QueryRow("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", 
        req.CartID, req.ItemID).Scan(&currentCount)
    
    newCount := currentCount + req.Count

    if err == sql.ErrNoRows {
        if req.Count > 0 {
            _, err = app.db.Exec("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)",
                req.CartID, req.ItemID, req.Count)
            if err != nil {
                return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                    "error": "Failed to add item",
                })
            }
        }
    } else if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Database error",
        })
    } else {
        if newCount > 1000000 {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Resulting count would be too large",
            })
        }
        
        if newCount <= 0 {
            _, err = app.db.Exec("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?",
                req.CartID, req.ItemID)
        } else {
            _, err = app.db.Exec("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?",
                newCount, req.CartID, req.ItemID)
        }
        
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to update item",
            })
        }
    }

    return c.SendStatus(fiber.StatusOK)
}

func (app *App) retrieveCart(c *fiber.Ctx) error {
    var req RetrieveCartRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid JSON",
        })
    }

    if req.CartID == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "cart_id is required",
        })
    }

    var exists int
    err := app.db.QueryRow("SELECT 1 FROM carts WHERE cart_id = ?", req.CartID).Scan(&exists)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                "error": "Cart not found",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Database error",
        })
    }

    rows, err := app.db.Query("SELECT item_id, count FROM cart_items WHERE cart_id = ?", req.CartID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Database error",
        })
    }
    defer rows.Close()

    var items []CartItem
    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ItemID, &item.Count); err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Database error",
            })
        }
        items = append(items, item)
    }

    if items == nil {
        items = []CartItem{}
    }

    return c.JSON(RetrieveCartResponse{
        Items: items,
    })
}