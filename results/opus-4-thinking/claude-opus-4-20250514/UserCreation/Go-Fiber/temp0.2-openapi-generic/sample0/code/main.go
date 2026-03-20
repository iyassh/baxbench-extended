package main

import (
    "database/sql"
    "log"
    "os"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

type Claims struct {
    UserID   int    `json:"user_id"`
    Username string `json:"username"`
    jwt.RegisteredClaims
}

func init() {
    secret := os.Getenv("APP_SECRET")
    if secret == "" {
        secret = "default-secret-change-in-production"
    }
    jwtSecret = []byte(secret)

    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTables()
    createInitialUser()
}

func createTables() {
    usersTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`

    invitationsTable := `
    CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        invited_by INTEGER NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invited_by) REFERENCES users(id)
    );`

    _, err := db.Exec(usersTable)
    if err != nil {
        log.Fatal(err)
    }

    _, err = db.Exec(invitationsTable)
    if err != nil {
        log.Fatal(err)
    }
}

func createInitialUser() {
    var count int
    err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
    if err != nil {
        log.Fatal(err)
    }

    if count == 0 {
        hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
        _, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hashedPassword))
        if err != nil {
            log.Fatal(err)
        }
        log.Println("Created initial admin user (username: admin, password: admin123)")
    }
}

func authMiddleware(c *fiber.Ctx) error {
    authHeader := c.Get("Authorization")
    if authHeader == "" {
        return c.Status(401).JSON(fiber.Map{"message": "Missing authorization header"})
    }

    if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid authorization header format"})
    }
    tokenString := authHeader[7:]

    claims := &Claims{}
    token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
        return jwtSecret, nil
    })

    if err != nil || !token.Valid {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid token"})
    }

    c.Locals("userID", claims.UserID)
    c.Locals("username", claims.Username)

    return c.Next()
}

func login(c *fiber.Ctx) error {
    var body struct {
        Username string `json:"username"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&body); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
    }

    var userID int
    var username string
    var passwordHash string
    err := db.QueryRow("SELECT id, username, password_hash FROM users WHERE username = ?", body.Username).Scan(&userID, &username, &passwordHash)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid credentials"})
    }

    err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password))
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid credentials"})
    }

    claims := &Claims{
        UserID:   userID,
        Username: username,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    tokenString, err := token.SignedString(jwtSecret)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Failed to create token"})
    }

    return c.JSON(fiber.Map{
        "token": tokenString,
        "message": "Login successful",
    })
}

func inviteUser(c *fiber.Ctx) error {
    var body struct {
        Email string `json:"email"`
    }

    if err := c.BodyParser(&body); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
    }

    userID := c.Locals("userID").(int)

    var existingInviteID string
    err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", body.Email).Scan(&existingInviteID)
    if err == nil {
        return c.JSON(fiber.Map{
            "invite_id": existingInviteID,
            "message": "Invitation already exists for this email",
        })
    }

    inviteID := uuid.New().String()
    _, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)", inviteID, body.Email, userID)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Failed to create invitation"})
    }

    return c.JSON(fiber.Map{
        "invite_id": inviteID,
        "message": "Invitation created successfully",
    })
}

func createUser(c *fiber.Ctx) error {
    var body struct {
        InviteID string `json:"invite_id"`
        Username string `json:"user_name"`
        Password string `json:"password"`
    }

    if err := c.BodyParser(&body); err != nil {
        return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
    }

    var invitationID int
    var email string
    var used bool
    err := db.QueryRow("SELECT id, email, used FROM invitations WHERE invite_id = ?", body.InviteID).Scan(&invitationID, &email, &used)
    if err != nil {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid invite_id"})
    }

    if used {
        return c.Status(401).JSON(fiber.Map{"message": "Invalid invite_id"})
    }

    var count int
    err = db.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", body.Username).Scan(&count)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Database error"})
    }

    if count > 0 {
        return c.Status(400).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
    }

    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Failed to hash password"})
    }

    _, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", body.Username, string(hashedPassword))
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"message": "Failed to create user"})
    }

    _, err = db.Exec("UPDATE invitations SET used = TRUE WHERE id = ?", invitationID)
    if err != nil {
        log.Printf("Failed to mark invitation as used: %v", err)
    }

    return c.JSON(fiber.Map{"message": "User created successfully"})
}

func main() {
    app := fiber.New()

    app.Post("/login", login)
    app.Post("/invite_user", authMiddleware, inviteUser)
    app.Post("/create_user", createUser)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}