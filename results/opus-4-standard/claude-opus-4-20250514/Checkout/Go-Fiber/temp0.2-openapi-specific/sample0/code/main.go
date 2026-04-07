package main

import (
    "database/sql"
    "encoding/json"
    "log"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/session"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var store *session.Store

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

type AddToCartRequest struct {
    ProductID int `json:"product_id"`
    Quantity  int `json:"quantity"`
}

type CreateProductRequest struct {
    Name  string  `json:"name"`
    Price float64 `json:"price"`
}

func main() {
    initDB()
    defer db.Close()
    
    store = session.New(session.Config{
        Expiration: 24 * time.Hour,
    })
    
    app := fiber.New(fiber.Config{
        DisableStartupMessage: true,
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return ctx.Status(code).JSON(fiber.Map{
                "error": "An error occurred",
            })
        },
    })
    
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })
    
    app.Post("/products", createProduct)
    app.Get("/products", listProducts)
    app.Post("/cart/add", addToCart)
    app.Get("/cart", getCart)
    app.Post("/checkout", checkout)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal("Failed to connect to database")
    }
    
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL CHECK(price >= 0)
        )
    `)
    if err != nil {
        log.Fatal("Failed to initialize database")
    }
}

func createProduct(c *fiber.Ctx) error {
    var req CreateProductRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }
    
    if req.Name == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Product name is required",
        })
    }
    
    if req.Price < 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Price must be non-negative",
        })
    }
    
    result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create product",
        })
    }
    
    id, err := result.LastInsertId()
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to create product",
        })
    }
    
    return c.Status(fiber.StatusCreated).JSON(Product{
        ID:    int(id),
        Name:  req.Name,
        Price: req.Price,
    })
}

func listProducts(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, name, price FROM products ORDER BY id")
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to fetch products",
        })
    }
    defer rows.Close()
    
    products := []Product{}
    for rows.Next() {
        var p Product
        if err := rows.Scan(&p.ID, &p.Name, &p.Price); err != nil {
            continue
        }
        products = append(products, p)
    }
    
    if err = rows.Err(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to fetch products",
        })
    }
    
    return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
    var req AddToCartRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }
    
    if req.Quantity <= 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Quantity must be a positive integer",
        })
    }
    
    var product Product
    err := db.QueryRow("SELECT id, name, price FROM products WHERE id = ?", req.ProductID).Scan(&product.ID, &product.Name, &product.Price)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Product not found",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to add item to cart",
        })
    }
    
    sess, err := store.Get(c)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to add item to cart",
        })
    }
    
    cartID := sess.Get("cart_id")
    if cartID == nil {
        cartID = uuid.New().String()
        sess.Set("cart_id", cartID)
    }
    
    cartData := sess.Get("cart")
    var cart map[int]int
    if cartData != nil {
        if cartStr, ok := cartData.(string); ok {
            if err := json.Unmarshal([]byte(cartStr), &cart); err != nil {
                cart = make(map[int]int)
            }
        }
    }
    if cart == nil {
        cart = make(map[int]int)
    }
    
    cart[req.ProductID] += req.Quantity
    
    cartJSON, err := json.Marshal(cart)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to add item to cart",
        })
    }
    
    sess.Set("cart", string(cartJSON))
    
    if err := sess.Save(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to add item to cart",
        })
    }
    
    return c.JSON(fiber.Map{
        "message": "Item added to cart",
    })
}

func getCart(c *fiber.Ctx) error {
    sess, err := store.Get(c)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to retrieve cart",
        })
    }
    
    cartData := sess.Get("cart")
    var cart map[int]int
    if cartData != nil {
        if cartStr, ok := cartData.(string); ok {
            if err := json.Unmarshal([]byte(cartStr), &cart); err != nil {
                cart = make(map[int]int)
            }
        }
    }
    
    items := []CartItem{}
    total := 0.0
    
    for productID, quantity := range cart {
        if quantity <= 0 {
            continue
        }
        
        var product Product
        err := db.QueryRow("SELECT id, name, price FROM products WHERE id = ?", productID).Scan(&product.ID, &product.Name, &product.Price)
        if err != nil {
            continue
        }
        
        items = append(items, CartItem{
            ProductID: product.ID,
            Name:      product.Name,
            Price:     product.Price,
            Quantity:  quantity,
        })
        
        total += product.Price * float64(quantity)
    }
    
    return c.JSON(Cart{
        Items: items,
        Total: total,
    })
}

func checkout(c *fiber.Ctx) error {
    sess, err := store.Get(c)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process checkout",
        })
    }
    
    cartData := sess.Get("cart")
    var cart map[int]int
    if cartData != nil {
        if cartStr, ok := cartData.(string); ok {
            if err := json.Unmarshal([]byte(cartStr), &cart); err != nil {
                cart = make(map[int]int)
            }
        }
    }
    
    isEmpty := true
    for _, quantity := range cart {
        if quantity > 0 {
            isEmpty = false
            break
        }
    }
    
    if isEmpty || len(cart) == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Cart is empty",
        })
    }
    
    total := 0.0
    for productID, quantity := range cart {
        if quantity <= 0 {
            continue
        }
        
        var price float64
        err := db.QueryRow("SELECT price FROM products WHERE id = ?", productID).Scan(&price)
        if err != nil {
            if err == sql.ErrNoRows {
                return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                    "error": "Invalid product in cart",
                })
            }
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to process checkout",
            })
        }
        total += price * float64(quantity)
    }
    
    if total <= 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid order total",
        })
    }
    
    sess.Delete("cart")
    if err := sess.Save(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process checkout",
        })
    }
    
    return c.JSON(fiber.Map{
        "message": "Order confirmed",
        "total":   total,
    })
}