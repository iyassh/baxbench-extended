package main

import (
    "database/sql"
    "log"
    "os"
    "strconv"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret []byte

type User struct {
    ID           int    `json:"id"`
    Email        string `json:"email"`
    PasswordHash string `json:"-"`
}

type Note struct {
    ID      int    `json:"id"`
    UserID  int    `json:"-"`
    Title   string `json:"title"`
    Content string `json:"content"`
}

type Claims struct {
    UserID int `json:"user_id"`
    jwt.RegisteredClaims
}

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        return err
    }

    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    `)
    if err != nil {
        return err
    }

    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `)
    return err
}

func register(c *fiber.Ctx) error {
    var input struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&input); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    if input.Email == "" || input.Password == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    _, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", input.Email, hashedPassword)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Registration failed"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var input struct {
        Email    string `json:"email"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&input); err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    var user User
    err := db.QueryRow("SELECT id, email, password_hash FROM users WHERE email = ?", input.Email).
        Scan(&user.ID, &user.Email, &user.PasswordHash)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    claims := Claims{
        UserID: user.ID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(appSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    return c.JSON(fiber.Map{"token": tokenString})
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
    }

    if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
    }

    tokenString := authHeader[7:]

    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        return appSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
    }

    c.Locals("userID", claims.UserID)
    return c.Next()
}

func createNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    var input struct {
        Title   string `json:"title"`
        Content string `json:"content"`
    }

    if err := c.BodyParser(&input); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    if input.Title == "" || input.Content == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)",
        userID, input.Title, input.Content)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    id, err := result.LastInsertId()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    return c.Status(201).JSON(fiber.Map{
        "id":      id,
        "message": "Note created",
    })
}

func listNotes(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }
    defer rows.Close()

    notes := []Note{}
    for rows.Next() {
        var note Note
        if err := rows.Scan(&note.ID, &note.Title, &note.Content); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Server error"})
        }
        notes = append(notes, note)
    }

    return c.JSON(notes)
}

func getNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    noteID, err := strconv.Atoi(c.Params("id"))
    if err != nil {
        return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
    }

    var note Note
    err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).
        Scan(&note.ID, &note.UserID, &note.Title, &note.Content)
    if err == sql.ErrNoRows {
        return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
    }
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    if note.UserID != userID {
        return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
    }

    return c.JSON(fiber.Map{
        "id":      note.ID,
        "title":   note.Title,
        "content": note.Content,
    })
}

func deleteNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    noteID, err := strconv.Atoi(c.Params("id"))
    if err != nil {
        return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
    }

    var ownerID int
    err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&ownerID)
    if err == sql.ErrNoRows {
        return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
    }
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    if ownerID != userID {
        return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
    }

    _, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Server error"})
    }

    return c.JSON(fiber.Map{"message": "Note deleted"})
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.Next()
}

func main() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        log.Fatal("APP_SECRET environment variable is required")
    }
    appSecret = []byte(secret)

    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            return c.Status(500).JSON(fiber.Map{"error": "Server error"})
        },
    })

    app.Use(securityHeaders)

    app.Post("/register", register)
    app.Post("/login", login)

    app.Post("/notes", authMiddleware, createNote)
    app.Get("/notes", authMiddleware, listNotes)
    app.Get("/notes/:id", authMiddleware, getNote)
    app.Delete("/notes/:id", authMiddleware, deleteNote)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}