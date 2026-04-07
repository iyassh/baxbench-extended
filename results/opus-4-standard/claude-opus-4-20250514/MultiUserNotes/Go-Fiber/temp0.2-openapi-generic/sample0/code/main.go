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

type User struct {
    ID       int    `json:"id"`
    Email    string `json:"email"`
    Password string `json:"-"`
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

var db *sql.DB
var jwtSecret []byte

func main() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-key"
    }
    jwtSecret = []byte(secret)

    initDB()

    app := fiber.New()

    app.Post("/register", register)
    app.Post("/login", login)

    app.Post("/notes", authenticate, createNote)
    app.Get("/notes", authenticate, listNotes)
    app.Get("/notes/:id", authenticate, getNote)
    app.Delete("/notes/:id", authenticate, deleteNote)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }

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
        log.Fatal("Failed to create tables:", err)
    }
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
    }

    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    if count > 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
    }

    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to hash password"})
    }

    _, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, hashedPassword)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create user"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    var user User
    err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": user.ID,
        "email":   user.Email,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })

    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
    }

    return c.JSON(fiber.Map{"token": tokenString})
}

func authenticate(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"error": "Missing authorization header"})
    }

    tokenString := ""
    if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
        tokenString = authHeader[7:]
    } else {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid authorization format"})
    }

    token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
    }

    claims, ok := token.Claims.(jwt.MapClaims)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid token claims"})
    }

    userID, ok := claims["user_id"].(float64)
    if !ok {
        return c.Status(401).JSON(fiber.Map{"error": "Invalid user ID in token"})
    }

    c.Locals("userID", int(userID))
    return c.Next()
}

func createNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    var req CreateNoteRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }

    if req.Title == "" || req.Content == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Title and content are required"})
    }

    result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, req.Title, req.Content)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to create note"})
    }

    noteID, err := result.LastInsertId()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to get note ID"})
    }

    return c.Status(201).JSON(fiber.Map{
        "id":      int(noteID),
        "message": "Note created",
    })
}

func listNotes(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)

    rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch notes"})
    }
    defer rows.Close()

    notes := []Note{}
    for rows.Next() {
        var note Note
        if err := rows.Scan(&note.ID, &note.Title, &note.Content); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to scan note"})
        }
        notes = append(notes, note)
    }

    return c.JSON(notes)
}

func getNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    
    noteIDParam := c.Params("id")
    noteID, err := strconv.Atoi(noteIDParam)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
    }

    var note Note
    var noteUserID int
    err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&note.ID, &noteUserID, &note.Title, &note.Content)
    if err == sql.ErrNoRows {
        return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
    }
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch note"})
    }

    if noteUserID != userID {
        return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
    }

    return c.JSON(note)
}

func deleteNote(c *fiber.Ctx) error {
    userID := c.Locals("userID").(int)
    
    noteIDParam := c.Params("id")
    noteID, err := strconv.Atoi(noteIDParam)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
    }

    var noteUserID int
    err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&noteUserID)
    if err == sql.ErrNoRows {
        return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
    }
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to check note"})
    }

    if noteUserID != userID {
        return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
    }

    _, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to delete note"})
    }

    return c.Status(200).JSON(fiber.Map{"message": "Note deleted"})
}