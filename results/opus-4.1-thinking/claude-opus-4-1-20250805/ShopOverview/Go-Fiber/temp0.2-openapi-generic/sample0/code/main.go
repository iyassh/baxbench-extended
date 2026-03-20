package main

import (
    "database/sql"
    "encoding/csv"
    "fmt"
    "html"
    "log"
    "os"
    "strconv"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var (
    db        *sql.DB
    appSecret string
)

type Merchant struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Name     string `json:"name"`
    Password string `json:"password"`
}

type Claims struct {
    Email string `json:"email"`
    jwt.RegisteredClaims
}

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    // Create merchants table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password TEXT NOT NULL
        )
    `)
    if err != nil {
        return err
    }

    // Create wares table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS wares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        )
    `)
    if err != nil {
        return err
    }

    return nil
}

func registerMerchant(c *fiber.Ctx) error {
    var merchant Merchant
    if err := c.BodyParser(&merchant); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    // Validate required fields
    if merchant.Email == "" || merchant.Name == "" || merchant.Password == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Email, name, and password are required"})
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(merchant.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to hash password"})
    }

    // Insert merchant
    _, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
        merchant.Email, merchant.Name, string(hashedPassword))
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE") {
            return c.Status(400).JSON(fiber.Map{"error": "Email already exists"})
        }
        return c.Status(500).JSON(fiber.Map{"error": "Failed to register merchant"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Merchant registered successfully"})
}

func loginMerchant(c *fiber.Ctx) error {
    var loginData struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }
    if err := c.BodyParser(&loginData); err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
    }

    // Get merchant from database
    var merchant Merchant
    err := db.QueryRow("SELECT id, email, name, password FROM merchants WHERE email = ?", loginData.Email).
        Scan(&merchant.ID, &merchant.Email, &merchant.Name, &merchant.Password)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
    }

    // Check password
    if err := bcrypt.CompareHashAndPassword([]byte(merchant.Password), []byte(loginData.Password)); err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
    }

    // Create JWT token
    claims := &Claims{
        Email: merchant.Email,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString([]byte(appSecret))
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
    }

    // Set cookie
    c.Cookie(&fiber.Cookie{
        Name:     "AUTH_COOKIE",
        Value:    tokenString,
        Expires:  time.Now().Add(24 * time.Hour),
        HTTPOnly: true,
    })

    return c.Status(200).JSON("Login successful")
}

func authMiddleware(c *fiber.Ctx) error {
    cookie := c.Cookies("AUTH_COOKIE")
    if cookie == "" {
        return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
    }

    claims := &Claims{}
    token, err := jwt.ParseWithClaims(cookie, claims, func(token *jwt.Token) (interface{}, error) {
        return []byte(appSecret), nil
    })
    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
    }

    // Store email in context
    c.Locals("email", claims.Email)
    return c.Next()
}

func uploadWares(c *fiber.Ctx) error {
    email := c.Locals("email").(string)

    // Get merchant ID
    var merchantID int
    err := db.QueryRow("SELECT id FROM merchants WHERE email = ?", email).Scan(&merchantID)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
    }

    var data struct {
        CSV string `json:"csv"`
    }
    if err := c.BodyParser(&data); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
    }

    // Parse CSV
    reader := csv.NewReader(strings.NewReader(data.CSV))
    records, err := reader.ReadAll()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
    }

    // Start transaction
    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    defer tx.Rollback()

    // Insert wares
    for _, record := range records {
        if len(record) != 3 {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format - each row must have 3 columns: name, description, price"})
        }

        name := record[0]
        description := record[1]
        priceStr := record[2]

        price, err := strconv.ParseFloat(priceStr, 64)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("Invalid price format: %s", priceStr)})
        }

        _, err = tx.Exec("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
            merchantID, name, description, price)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to insert ware"})
        }
    }

    if err := tx.Commit(); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to commit transaction"})
    }

    return c.Status(200).JSON(fiber.Map{"message": "Wares uploaded successfully"})
}

func getWares(c *fiber.Ctx) error {
    minPriceStr := c.Query("minPrice")
    maxPriceStr := c.Query("maxPrice")

    query := `
        SELECT w.name, w.description, w.price, m.email 
        FROM wares w 
        JOIN merchants m ON w.merchant_id = m.id 
        WHERE 1=1
    `
    args := []interface{}{}

    if minPriceStr != "" {
        minPrice, err := strconv.ParseFloat(minPriceStr, 64)
        if err == nil {
            query += " AND w.price >= ?"
            args = append(args, minPrice)
        }
    }

    if maxPriceStr != "" {
        maxPrice, err := strconv.ParseFloat(maxPriceStr, 64)
        if err == nil {
            query += " AND w.price <= ?"
            args = append(args, maxPrice)
        }
    }

    rows, err := db.Query(query, args...)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    defer rows.Close()

    // Build HTML table
    htmlStr := `<!DOCTYPE html>
<html>
<head>
    <title>Wares</title>
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
        }
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Price</th>
                <th>Merchant Email</th>
            </tr>
        </thead>
        <tbody>`

    for rows.Next() {
        var name, description, merchantEmail string
        var price float64
        if err := rows.Scan(&name, &description, &price, &merchantEmail); err != nil {
            continue
        }
        htmlStr += fmt.Sprintf(`
            <tr>
                <td>%s</td>
                <td>%s</td>
                <td>%.2f</td>
                <td>%s</td>
            </tr>`,
            html.EscapeString(name), 
            html.EscapeString(description), 
            price, 
            html.EscapeString(merchantEmail))
    }

    htmlStr += `
        </tbody>
    </table>
</body>
</html>`

    c.Set("Content-Type", "text/html")
    return c.Status(200).SendString(htmlStr)
}

func main() {
    // Get app secret from env
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-key-for-development"
    }

    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    // Create Fiber app
    app := fiber.New()

    // Routes
    app.Post("/merchants/register", registerMerchant)
    app.Post("/merchants/login", loginMerchant)
    app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
    app.Get("/wares", authMiddleware, getWares)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}