package main

import (
    "database/sql"
    "encoding/csv"
    "fmt"
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

var db *sql.DB
var jwtSecret []byte

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

func main() {
    // Initialize JWT secret
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()
    defer db.Close()

    app := fiber.New()

    // Routes
    app.Post("/merchants/register", registerMerchant)
    app.Post("/merchants/login", loginMerchant)
    app.Post("/merchants/upload-wares", authMiddleware, uploadWares)
    app.Get("/wares", authMiddleware, getWares)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables
    createMerchantsTable := `
    CREATE TABLE IF NOT EXISTS merchants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password TEXT NOT NULL
    )`

    createWaresTable := `
    CREATE TABLE IF NOT EXISTS wares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price REAL NOT NULL,
        merchant_id INTEGER NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )`

    _, err = db.Exec(createMerchantsTable)
    if err != nil {
        log.Fatal(err)
    }

    _, err = db.Exec(createWaresTable)
    if err != nil {
        log.Fatal(err)
    }
}

func registerMerchant(c *fiber.Ctx) error {
    var merchant Merchant
    if err := c.BodyParser(&merchant); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    // Validate input
    if merchant.Email == "" || merchant.Name == "" || merchant.Password == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(merchant.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    // Insert merchant
    _, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)",
        merchant.Email, merchant.Name, string(hashedPassword))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    return c.SendStatus(201)
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
    var storedPassword string
    err := db.QueryRow("SELECT password FROM merchants WHERE email = ?", loginData.Email).Scan(&storedPassword)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
    }

    // Check password
    err = bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(loginData.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
    }

    // Create JWT token
    claims := &Claims{
        Email: loginData.Email,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    // Set cookie
    cookie := new(fiber.Cookie)
    cookie.Name = "AUTH_COOKIE"
    cookie.Value = tokenString
    cookie.HTTPOnly = true
    cookie.Expires = time.Now().Add(24 * time.Hour)
    c.Cookie(cookie)

    return c.JSON("Login successful")
}

func authMiddleware(c *fiber.Ctx) error {
    cookie := c.Cookies("AUTH_COOKIE")
    if cookie == "" {
        return c.SendStatus(401)
    }

    claims := &Claims{}
    token, err := jwt.ParseWithClaims(cookie, claims, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.SendStatus(401)
    }

    c.Locals("email", claims.Email)
    return c.Next()
}

func uploadWares(c *fiber.Ctx) error {
    email := c.Locals("email").(string)

    // Get merchant ID
    var merchantID int
    err := db.QueryRow("SELECT id FROM merchants WHERE email = ?", email).Scan(&merchantID)
    if err != nil {
        return c.SendStatus(401)
    }

    var requestData struct {
        CSV string `json:"csv"`
    }

    if err := c.BodyParser(&requestData); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
    }

    // Parse CSV
    reader := csv.NewReader(strings.NewReader(requestData.CSV))
    records, err := reader.ReadAll()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
    }

    // Insert wares
    for _, record := range records {
        if len(record) != 3 {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
        }

        name := record[0]
        description := record[1]
        priceStr := record[2]

        price, err := strconv.ParseFloat(priceStr, 64)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
        }

        _, err = db.Exec("INSERT INTO wares (name, description, price, merchant_id) VALUES (?, ?, ?, ?)",
            name, description, price, merchantID)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid CSV format"})
        }
    }

    return c.SendString("Wares uploaded successfully")
}

func getWares(c *fiber.Ctx) error {
    minPriceStr := c.Query("minPrice")
    maxPriceStr := c.Query("maxPrice")

    query := `
        SELECT w.name, w.price, w.description, m.email 
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
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer rows.Close()

    // Build HTML table
    html := `<!DOCTYPE html>
<html>
<head>
    <title>Wares</title>
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
        }
        th, td {
            border: 1px solid black;
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
        <tr>
            <th>Name</th>
            <th>Price</th>
            <th>Description</th>
            <th>Merchant Email</th>
        </tr>`

    for rows.Next() {
        var name, description, email string
        var price float64
        if err := rows.Scan(&name, &price, &description, &email); err != nil {
            continue
        }
        html += fmt.Sprintf(`
        <tr>
            <td>%s</td>
            <td>%.2f</td>
            <td>%s</td>
            <td>%s</td>
        </tr>`, name, price, description, email)
    }

    html += `
    </table>
</body>
</html>`

    c.Type("html")
    return c.SendString(html)
}