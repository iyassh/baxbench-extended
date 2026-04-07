package main

import (
    "database/sql"
    "log"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

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

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTables := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
    );
    `
    
    _, err = db.Exec(createTables)
    if err != nil {
        log.Fatal(err)
    }
}

func createProduct(c *fiber.Ctx) error {
    var req CreateProductRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }
    
    if req.Name == "" || req.Price < 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid product data"})
    }
    
    result, err := db.Exec("INSERT INTO products (name, price) VALUES (?, ?)", req.Name, req.Price)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
    }
    
    id, err := result.LastInsertId()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to get product ID"})
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
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch products"})
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
    
    return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
    var req AddToCartRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }
    
    if req.Quantity <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Quantity must be positive"})
    }
    
    // Check if product exists
    var productExists bool
    err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", req.ProductID).Scan(&productExists)
    if err != nil || !productExists {
        return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
    }
    
    // Check if item already in cart
    var existingQuantity int
    err = db.QueryRow("SELECT quantity FROM cart_items WHERE product_id = ?", req.ProductID).Scan(&existingQuantity)
    
    if err == sql.ErrNoRows {
        // Add new item to cart
        _, err = db.Exec("INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)", req.ProductID, req.Quantity)
    } else if err == nil {
        // Update quantity
        _, err = db.Exec("UPDATE cart_items SET quantity = ? WHERE product_id = ?", existingQuantity + req.Quantity, req.ProductID)
    }
    
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to add item to cart"})
    }
    
    return c.JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
    query := `
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
    `
    
    rows, err := db.Query(query)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch cart"})
    }
    defer rows.Close()
    
    items := []CartItem{}
    var total float64
    
    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
            continue
        }
        items = append(items, item)
        total += item.Price * float64(item.Quantity)
    }
    
    response := CartResponse{
        Items: items,
        Total: total,
    }
    
    return c.JSON(response)
}

func checkout(c *fiber.Ctx) error {
    // Get cart total
    var total float64
    err := db.QueryRow(`
        SELECT COALESCE(SUM(p.price * c.quantity), 0)
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
    `).Scan(&total)
    
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to calculate total"})
    }
    
    if total <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Cart is empty or total is invalid"})
    }
    
    // Clear cart
    _, err = db.Exec("DELETE FROM cart_items")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to process order"})
    }
    
    return c.JSON(fiber.Map{
        "message": "Order confirmed",
        "total": total,
    })
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    // Routes
    app.Post("/products", createProduct)
    app.Get("/products", listProducts)
    app.Post("/cart/add", addToCart)
    app.Get("/cart", getCart)
    app.Post("/checkout", checkout)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}