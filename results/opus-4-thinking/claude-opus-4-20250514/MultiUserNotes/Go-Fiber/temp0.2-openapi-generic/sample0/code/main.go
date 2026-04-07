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

// User struct
type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Password string `json:"password"`
}

// Note struct
type Note struct {
    ID      int    `json:"id"`
    UserID  int    `json:"user_id"`
    Title   string `json:"title"`
    Content string `json:"content"`
}

// JWT Claims
type Claims struct {
    UserID int    `json:"user_id"`
    Email  string `json:"email"`
    jwt.RegisteredClaims
}

var db *sql.DB

func main() {
    // Initialize database
    initDB()

    // Create Fiber app
    app := fiber.New()

    // Routes
    app.Post("/register", register)
    app.Post("/login", login)
    app.Post("/notes", authMiddleware, createNote)
    app.Get("/notes", authMiddleware, getNotes)
    app.Get("/notes/:id", authMiddleware, getNote)
    app.Delete("/notes/:id", authMiddleware, deleteNote)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create tables
    createTables := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    `

    _, err = db.Exec(createTables)
    if err != nil {
        log.Fatal(err)
    }
}

// Authentication middleware
func authMiddleware(c *fiber.Ctx) error {
    // Get token from header
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.SendStatus(fiber.StatusUnauthorized)
    }

    // Check Bearer prefix
    if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.SendStatus(fiber.StatusUnauthorized)
    }

    // Extract token
    tokenString := authHeader[7:]

    // Parse token
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        secret := os.Getenv("APP_SECRET")
        if secret == "" {
            secret = "default-secret-key"
        }
        return []byte(secret), nil
    })

    if err != nil || !token.Valid {
        return c.SendStatus(fiber.StatusUnauthorized)
    }

    claims, ok := token.Claims.(*Claims)
    if !ok {
        return c.SendStatus(fiber.StatusUnauthorized)
    }

    // Store user info in context
    c.Locals("userID", claims.UserID)
    c.Locals("email", claims.Email)

    return c.Next()
}

// Register handler
func register(c *fiber.Ctx) error {
    var user User
    if err := c.BodyParser(&user); err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Validate email and password
    if user.Email == "" || user.Password == "" {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }

    // Insert user into database
    _, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", user.Email, string(hashedPassword))
    if err != nil {
        // Email already in use or other error
        return c.SendStatus(fiber.StatusBadRequest)
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Registration successful"})
}

// Login handler
func login(c *fiber.Ctx) error {
    var loginData User
    if err := c.BodyParser(&loginData); err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Get user from database
    var user User
    err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", loginData.Email).Scan(&user.ID, &user.Email, &user.Password)
    if err != nil {
        return c.SendStatus(fiber.StatusUnauthorized)
    }

    // Verify password
    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(loginData.Password))
    if err != nil {
        return c.SendStatus(fiber.StatusUnauthorized)
    }

    // Create JWT token
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }

    claims := Claims{
        UserID: user.ID,
        Email:  user.Email,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString([]byte(secret))
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }

    return c.JSON(fiber.Map{"token": tokenString})
}

// Create note handler
func createNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    var note Note
    if err := c.BodyParser(&note); err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Validate
    if note.Title == "" || note.Content == "" {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Insert note
    result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, note.Title, note.Content)
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }

    id, _ := result.LastInsertId()
    return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": int(id), "message": "Note created"})
}

// Get notes handler
func getNotes(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }
    defer rows.Close()

    var notes []fiber.Map
    for rows.Next() {
        var note Note
        err := rows.Scan(&note.ID, &note.Title, &note.Content)
        if err != nil {
            continue
        }
        notes = append(notes, fiber.Map{
            "id":      note.ID,
            "title":   note.Title,
            "content": note.Content,
        })
    }

    if notes == nil {
        notes = []fiber.Map{}
    }

    return c.JSON(notes)
}

// Get specific note handler
func getNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    noteID, err := strconv.Atoi(c.Params("id"))
    if err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    var note Note
    err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&note.ID, &note.UserID, &note.Title, &note.Content)
    if err != nil {
        return c.SendStatus(fiber.StatusNotFound)
    }

    // Check ownership
    if note.UserID != userID {
        return c.SendStatus(fiber.StatusForbidden)
    }

    return c.JSON(fiber.Map{
        "id":      note.ID,
        "title":   note.Title,
        "content": note.Content,
    })
}

// Delete note handler
func deleteNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    noteID, err := strconv.Atoi(c.Params("id"))
    if err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Check if note exists and belongs to user
    var ownerID int
    err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&ownerID)
    if err != nil {
        return c.SendStatus(fiber.StatusNotFound)
    }

    if ownerID != userID {
        return c.SendStatus(fiber.StatusForbidden)
    }

    // Delete note
    _, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
    if err != nil {
        return c.SendStatus(fiber.StatusInternalServerError)
    }

    return c.SendStatus(fiber.StatusOK)
}