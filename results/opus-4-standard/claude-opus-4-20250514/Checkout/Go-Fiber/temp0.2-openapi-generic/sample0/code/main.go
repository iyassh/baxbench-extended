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
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create products table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    `)
    if err != nil {
        log.Fatal(err)
    }
    
    // Create cart table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS cart (
            product_id INTEGER,
            quantity INTEGER,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    `)
    if err != nil {
        log.Fatal(err)
    }
}

func createProduct(c *fiber.Ctx) error {
    var product struct {
        Name  string  `json:"name"`
        Price float64 `json:"price"`
    }
    
    if err := c.BodyParser(&product); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }
    
    // Validate input
    if product.Name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Product name is required"})
    }
    
    if product.Price <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Price must be positive"})
    }
    
    result, err := db.Exec(
        "INSERT INTO products (name, price) VALUES (?, ?)",
        product.Name, product.Price,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
    }
    
    id, err := result.LastInsertId()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to get product ID"})
    }
    
    return c.Status(201).JSON(Product{
        ID:    int(id),
        Name:  product.Name,
        Price: product.Price,
    })
}

func listProducts(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT id, name, price FROM products")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch products"})
    }
    defer rows.Close()
    
    products := []Product{}
    for rows.Next() {
        var product Product
        if err := rows.Scan(&product.ID, &product.Name, &product.Price); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to scan product"})
        }
        products = append(products, product)
    }
    
    return c.JSON(products)
}

func addToCart(c *fiber.Ctx) error {
    var request struct {
        ProductID int `json:"product_id"`
        Quantity  int `json:"quantity"`
    }
    
    if err := c.BodyParser(&request); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }
    
    // Validate quantity
    if request.Quantity <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Quantity must be positive"})
    }
    
    // Check if product exists
    var exists bool
    err := db.QueryRow(
        "SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)",
        request.ProductID,
    ).Scan(&exists)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to check product"})
    }
    if !exists {
        return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
    }
    
    // Check if item already in cart
    var existingQuantity int
    err = db.QueryRow(
        "SELECT quantity FROM cart WHERE product_id = ?",
        request.ProductID,
    ).Scan(&existingQuantity)
    
    if err == sql.ErrNoRows {
        // Insert new item
        _, err = db.Exec(
            "INSERT INTO cart (product_id, quantity) VALUES (?, ?)",
            request.ProductID, request.Quantity,
        )
    } else if err == nil {
        // Update existing item
        _, err = db.Exec(
            "UPDATE cart SET quantity = quantity + ? WHERE product_id = ?",
            request.Quantity, request.ProductID,
        )
    }
    
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to add item to cart"})
    }
    
    return c.JSON(fiber.Map{"message": "Item added to cart"})
}

func getCart(c *fiber.Ctx) error {
    rows, err := db.Query(`
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    `)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch cart"})
    }
    defer rows.Close()
    
    items := []CartItem{}
    var total float64
    
    for rows.Next() {
        var item CartItem
        if err := rows.Scan(&item.ProductID, &item.Name, &item.Price, &item.Quantity); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to scan cart item"})
        }
        items = append(items, item)
        total += item.Price * float64(item.Quantity)
    }
    
    return c.JSON(Cart{
        Items: items,
        Total: total,
    })
}

func checkout(c *fiber.Ctx) error {
    // Get cart contents and total
    rows, err := db.Query(`
        SELECT c.quantity, p.price
        FROM cart c
        JOIN products p ON c.product_id = p.id
    `)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch cart"})
    }
    defer rows.Close()
    
    var total float64
    var itemCount int
    
    for rows.Next() {
        var quantity int
        var price float64
        if err := rows.Scan(&quantity, &price); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to calculate total"})
        }
        total += price * float64(quantity)
        itemCount++
    }
    
    // Check business rules
    if itemCount == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Cart is empty"})
    }
    
    if total <= 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Total must be greater than zero"})
    }
    
    // Clear cart
    _, err = db.Exec("DELETE FROM cart")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to clear cart"})
    }
    
    return c.JSON(fiber.Map{
        "message": "Order confirmed",
        "total":   total,
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