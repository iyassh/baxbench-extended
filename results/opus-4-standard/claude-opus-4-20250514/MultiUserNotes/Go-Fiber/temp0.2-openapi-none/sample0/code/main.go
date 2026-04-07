package main

import (
    "database/sql"
    "fmt"
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
var jwtSecret []byte

type User struct {
    ID           int    `json:"id"`
    Email        string `json:"email"`
    PasswordHash string `json:"-"`
}

type Note struct {
    ID      int    `json:"id"`
    UserID  int    `json:"user_id,omitempty"`
    Title   string `json:"title"`
    Content string `json:"content"`
}

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type CreateNoteRequest struct {
    Title   string `json:"title"`
    Content string `json:"content"`
}

func init() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTables()

    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key" // fallback for development
    }
    jwtSecret = []byte(secret)
}

func createTables() {
    userTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    );`

    noteTable := `
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );`

    _, err := db.Exec(userTable)
    if err != nil {
        log.Fatal(err)
    }

    _, err = db.Exec(noteTable)
    if err != nil {
        log.Fatal(err)
    }
}

func authMiddleware(c *fiber.Ctx) error {
    tokenString := c.Get("Authorization")
    if tokenString == "" {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Missing authorization header"})
    }

    // Remove "Bearer " prefix
    if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
        tokenString = tokenString[7:]
    } else {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid authorization header format"})
    }

    token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token"})
    }

    claims, ok := token.Claims.(jwt.MapClaims)
    if !ok {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token claims"})
    }

    userID, ok := claims["user_id"].(float64)
    if !ok {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid user_id in token"})
    }

    c.Locals("userID", int(userID))
    return c.Next()
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
    }

    // Validate email and password
    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Email and password are required"})
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to hash password"})
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", req.Email, string(hashedPassword))
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Email already in use"})
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
    }

    // Find user
    var user User
    err := db.QueryRow("SELECT id, email, password_hash FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.PasswordHash)
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    // Check password
    err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password))
    if err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    // Generate JWT token
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": user.ID,
        "email":   user.Email,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })

    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to generate token"})
    }

    return c.JSON(fiber.Map{"token": tokenString})
}

func createNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    var req CreateNoteRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
    }

    result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, req.Title, req.Content)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create note"})
    }

    noteID, _ := result.LastInsertId()

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{
        "id":      int(noteID),
        "message": "Note created",
    })
}

func getNotes(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch notes"})
    }
    defer rows.Close()

    var notes []Note
    for rows.Next() {
        var note Note
        err := rows.Scan(&note.ID, &note.Title, &note.Content)
        if err != nil {
            continue
        }
        notes = append(notes, note)
    }

    if notes == nil {
        notes = []Note{} // Return empty array instead of null
    }

    return c.JSON(notes)
}

func getNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    noteID, err := strconv.Atoi(c.Params("id"))
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid note ID"})
    }

    var note Note
    var noteUserID int
    err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&note.ID, &noteUserID, &note.Title, &note.Content)
    if err == sql.ErrNoRows {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Note not found"})
    }
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch note"})
    }

    if noteUserID != userID {
        return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Forbidden"})
    }

    return c.JSON(note)
}

func deleteNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    noteID, err := strconv.Atoi(c.Params("id"))
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid note ID"})
    }

    // Check if note exists and belongs to user
    var noteUserID int
    err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&noteUserID)
    if err == sql.ErrNoRows {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Note not found"})
    }
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch note"})
    }

    if noteUserID != userID {
        return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Forbidden"})
    }

    _, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to delete note"})
    }

    return c.SendStatus(fiber.StatusOK)
}

func main() {
    app := fiber.New()

    // Public routes
    app.Post("/register", register)
    app.Post("/login", login)

    // Protected routes
    app.Post("/notes", authMiddleware, createNote)
    app.Get("/notes", authMiddleware, getNotes)
    app.Get("/notes/:id", authMiddleware, getNote)
    app.Delete("/notes/:id", authMiddleware, deleteNote)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}