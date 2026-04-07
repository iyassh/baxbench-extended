package main

import (
    "database/sql"
    "errors"
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

type LoginRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type RegisterRequest struct {
    Email    string `json:"email"`
    Password string `json:"password"`
}

type CreateNoteRequest struct {
    Title   string `json:"title"`
    Content string `json:"content"`
}

var db *sql.DB
var jwtSecret []byte

func init() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        jwtSecret = []byte("default-secret-key")
    } else {
        jwtSecret = []byte(secret)
    }
}

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    // Create users table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    `)
    if err != nil {
        return err
    }

    // Create notes table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `)
    if err != nil {
        return err
    }

    return nil
}

func securityHeaders() fiber.Handler {
    return func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        return c.Next()
    }
}

func authMiddleware() fiber.Handler {
    return func(c *fiber.Ctx) error {
        authHeader := c.Get("Authorization")
        if authHeader == "" {
            return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                "error": "Missing authorization header",
            })
        }

        if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
            return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                "error": "Invalid authorization header format",
            })
        }

        tokenString := authHeader[7:]
        token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
            if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, errors.New("invalid signing method")
            }
            return jwtSecret, nil
        })

        if err != nil {
            return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                "error": "Invalid token",
            })
        }

        if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
            userID, ok := claims["user_id"].(float64)
            if !ok {
                return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                    "error": "Invalid token claims",
                })
            }
            c.Locals("user_id", int(userID))
            return c.Next()
        }

        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "error": "Invalid token",
        })
    }
}

func register(c *fiber.Ctx) error {
    var req RegisterRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Email and password are required",
        })
    }

    // Hash the password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        log.Printf("Error hashing password: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    // Insert user
    _, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, string(hashedPassword))
    if err != nil {
        // Check if it's a unique constraint violation
        if strings.Contains(err.Error(), "UNIQUE") {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Email already in use",
            })
        }
        log.Printf("Error inserting user: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{
        "message": "Registration successful",
    })
}

func login(c *fiber.Ctx) error {
    var req LoginRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }

    if req.Email == "" || req.Password == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Email and password are required",
        })
    }

    // Find user
    var user User
    err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
                "error": "Invalid credentials",
            })
        }
        log.Printf("Error querying user: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    // Verify password
    if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
        return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
            "error": "Invalid credentials",
        })
    }

    // Generate JWT token
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "user_id": user.ID,
        "email":   user.Email,
        "exp":     time.Now().Add(time.Hour * 24).Unix(),
    })

    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        log.Printf("Error generating token: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    return c.JSON(fiber.Map{
        "token": tokenString,
    })
}

func createNote(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)

    var req CreateNoteRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid request body",
        })
    }

    if req.Title == "" || req.Content == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Title and content are required",
        })
    }

    result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)",
        userID, req.Title, req.Content)
    if err != nil {
        log.Printf("Error inserting note: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    noteID, err := result.LastInsertId()
    if err != nil {
        log.Printf("Error getting last insert id: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    return c.Status(fiber.StatusCreated).JSON(fiber.Map{
        "id":      noteID,
        "message": "Note created",
    })
}

func listNotes(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)

    rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
    if err != nil {
        log.Printf("Error querying notes: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }
    defer rows.Close()

    notes := []Note{}
    for rows.Next() {
        var note Note
        if err := rows.Scan(&note.ID, &note.Title, &note.Content); err != nil {
            log.Printf("Error scanning note: %v", err)
            continue
        }
        notes = append(notes, note)
    }

    return c.JSON(notes)
}

func getNote(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)
    
    noteIDStr := c.Params("id")
    noteID, err := strconv.Atoi(noteIDStr)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid note ID",
        })
    }

    var note Note
    var dbUserID int
    err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(
        &note.ID, &dbUserID, &note.Title, &note.Content)
    
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                "error": "Note not found",
            })
        }
        log.Printf("Error querying note: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    // Check if the user owns the note
    if dbUserID != userID {
        return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
            "error": "Forbidden",
        })
    }

    return c.JSON(note)
}

func deleteNote(c *fiber.Ctx) error {
    userID := c.Locals("user_id").(int)
    
    noteIDStr := c.Params("id")
    noteID, err := strconv.Atoi(noteIDStr)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid note ID",
        })
    }

    // First check if the note exists and belongs to the user
    var dbUserID int
    err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&dbUserID)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                "error": "Note not found",
            })
        }
        log.Printf("Error querying note: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    // Check if the user owns the note
    if dbUserID != userID {
        return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
            "error": "Forbidden",
        })
    }

    // Delete the note
    _, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
    if err != nil {
        log.Printf("Error deleting note: %v", err)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }

    return c.JSON(fiber.Map{
        "message": "Note deleted",
    })
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).JSON(fiber.Map{
                "error": "An error occurred",
            })
        },
    })

    // Apply security headers to all routes
    app.Use(securityHeaders())

    // Public routes
    app.Post("/register", register)
    app.Post("/login", login)

    // Protected routes
    app.Post("/notes", authMiddleware(), createNote)
    app.Get("/notes", authMiddleware(), listNotes)
    app.Get("/notes/:id", authMiddleware(), getNote)
    app.Delete("/notes/:id", authMiddleware(), deleteNote)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}