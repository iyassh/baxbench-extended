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

var db *sql.DB
var jwtSecret []byte

func main() {
    // Initialize JWT secret
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }
    jwtSecret = []byte(secret)

    // Initialize database
    initDB()

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

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables
    merchantsTable := `
    CREATE TABLE IF NOT EXISTS merchants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL
    );`

    waresTable := `
    CREATE TABLE IF NOT EXISTS wares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    );`

    if _, err := db.Exec(merchantsTable); err != nil {
        log.Fatal(err)
    }
    if _, err := db.Exec(waresTable); err != nil {
        log.Fatal(err)
    }
}

func registerMerchant(c *fiber.Ctx) error {
    var merchant struct {
        Email    string `json:"email"`
        Name     string `json:"name"`
        Password string `json:"password"`
    }
    
    if err := c.BodyParser(&merchant); err != nil {
        return c.SendStatus(400)
    }

    if merchant.Email == "" || merchant.Name == "" || merchant.Password == "" {
        return c.SendStatus(400)
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(merchant.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.SendStatus(500)
    }

    // Insert merchant
    _, err = db.Exec("INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)",
        merchant.Email, merchant.Name, hashedPassword)
    if err != nil {
        return c.SendStatus(400)
    }

    return c.SendStatus(201)
}

func loginMerchant(c *fiber.Ctx) error {
    var loginReq struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }
    
    if err := c.BodyParser(&loginReq); err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
    }

    // Find merchant
    var id int
    var passwordHash string
    err := db.QueryRow("SELECT id, password_hash FROM merchants WHERE email = ?", loginReq.Email).Scan(&id, &passwordHash)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
    }

    // Verify password
    if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(loginReq.Password)); err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
    }

    // Create JWT token
    claims := jwt.MapClaims{
        "merchant_id": id,
        "email":       loginReq.Email,
        "exp":         time.Now().Add(time.Hour * 24).Unix(),
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create token"})
    }

    // Set cookie
    c.Cookie(&fiber.Cookie{
        Name:     "AUTH_COOKIE",
        Value:    tokenString,
        Expires:  time.Now().Add(time.Hour * 24),
        HTTPOnly: true,
    })

    return c.Status(200).JSON("Login successful")
}

func authMiddleware(c *fiber.Ctx) error {
    cookie := c.Cookies("AUTH_COOKIE")
    if cookie == "" {
        return c.SendStatus(401)
    }

    token, err := jwt.Parse(cookie, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method")
        }
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.SendStatus(401)
    }

    claims, ok := token.Claims.(jwt.MapClaims)
    if !ok {
        return c.SendStatus(401)
    }

    c.Locals("merchant_id", int(claims["merchant_id"].(float64)))
    c.Locals("email", claims["email"].(string))

    return c.Next()
}

func uploadWares(c *fiber.Ctx) error {
    var uploadReq struct {
        CSV string `json:"csv"`
    }
    
    if err := c.BodyParser(&uploadReq); err != nil {
        return c.SendStatus(400)
    }

    merchantID := c.Locals("merchant_id").(int)

    // Parse CSV
    reader := csv.NewReader(strings.NewReader(uploadReq.CSV))
    records, err := reader.ReadAll()
    if err != nil {
        return c.SendStatus(400)
    }

    // Insert wares
    tx, err := db.Begin()
    if err != nil {
        return c.SendStatus(500)
    }
    defer tx.Rollback()

    stmt, err := tx.Prepare("INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)")
    if err != nil {
        return c.SendStatus(500)
    }
    defer stmt.Close()

    for _, record := range records {
        if len(record) < 3 {
            return c.SendStatus(400)
        }

        price, err := strconv.ParseFloat(record[2], 64)
        if err != nil {
            return c.SendStatus(400)
        }

        if _, err := stmt.Exec(merchantID, record[0], record[1], price); err != nil {
            return c.SendStatus(500)
        }
    }

    if err := tx.Commit(); err != nil {
        return c.SendStatus(500)
    }

    return c.SendStatus(200)
}

func getWares(c *fiber.Ctx) error {
    minPriceStr := c.Query("minPrice")
    maxPriceStr := c.Query("maxPrice")

    query := `
        SELECT w.name, w.description, w.price, m.email 
        FROM wares w 
        JOIN merchants m ON w.merchant_id = m.id 
        WHERE 1=1`
    
    var args []interface{}

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
        return c.SendStatus(500)
    }
    defer rows.Close()

    var wares []struct {
        name          string
        description   string
        price         float64
        merchantEmail string
    }
    
    for rows.Next() {
        var ware struct {
            name          string
            description   string
            price         float64
            merchantEmail string
        }
        if err := rows.Scan(&ware.name, &ware.description, &ware.price, &ware.merchantEmail); err != nil {
            continue
        }
        wares = append(wares, ware)
    }

    // Generate HTML table
    htmlStr := `
    <!DOCTYPE html>
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
            <tr>
                <th>Ware Name</th>
                <th>Price</th>
                <th>Description</th>
                <th>Merchant Email</th>
            </tr>`

    for _, ware := range wares {
        htmlStr += fmt.Sprintf(`
            <tr>
                <td>%s</td>
                <td>%.2f</td>
                <td>%s</td>
                <td>%s</td>
            </tr>`,
            html.EscapeString(ware.name), 
            ware.price, 
            html.EscapeString(ware.description), 
            html.EscapeString(ware.merchantEmail))
    }

    htmlStr += `
        </table>
    </body>
    </html>`

    c.Set("Content-Type", "text/html")
    return c.SendString(htmlStr)
}