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
	Role     string `json:"role"`
}

type Claims struct {
	UserID int    `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func main() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}
	jwtSecret = []byte(secret)

	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			role TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)
	app.Get("/profile", authMiddleware, profileHandler)
	app.Get("/admin/users", authMiddleware, adminMiddleware, listUsersHandler)
	app.Delete("/admin/users/:id", authMiddleware, adminMiddleware, deleteUserHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func registerHandler(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request body")
	}

	if req.Email == "" || req.Password == "" {
		return fiber.NewError(fiber.StatusBadRequest, "Email and password are required")
	}

	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}

	role := "user"
	if count == 0 {
		role = "admin"
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Error processing password")
	}

	_, err = db.Exec("INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
		req.Email, string(hashedPassword), role)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Email already in use")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func loginHandler(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid request body")
	}

	if req.Email == "" || req.Password == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "Invalid credentials")
	}

	var user User
	err := db.QueryRow("SELECT id, email, password, role FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Password, &user.Role)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "Invalid credentials")
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "Invalid credentials")
	}

	claims := Claims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Error generating token")
	}

	return c.JSON(fiber.Map{
		"token": tokenString,
	})
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "Unauthorized")
	}

	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return fiber.NewError(fiber.StatusUnauthorized, "Unauthorized")
	}
	tokenString := authHeader[7:]

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return fiber.NewError(fiber.StatusUnauthorized, "Unauthorized")
	}

	c.Locals("user", claims)
	return c.Next()
}

func adminMiddleware(c *fiber.Ctx) error {
	claims, ok := c.Locals("user").(*Claims)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "Unauthorized")
	}

	if claims.Role != "admin" {
		return fiber.NewError(fiber.StatusForbidden, "Forbidden - admin access required")
	}

	return c.Next()
}

func profileHandler(c *fiber.Ctx) error {
	claims, ok := c.Locals("user").(*Claims)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "Unauthorized")
	}

	return c.JSON(fiber.Map{
		"email": claims.Email,
		"role":  claims.Role,
	})
}

func listUsersHandler(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, email, role FROM users")
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var user User
		err := rows.Scan(&user.ID, &user.Email, &user.Role)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "Database error")
		}
		users = append(users, user)
	}

	if err = rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}

	if users == nil {
		users = []User{}
	}

	return c.JSON(users)
}

func deleteUserHandler(c *fiber.Ctx) error {
	idParam := c.Params("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid user ID")
	}

	result, err := db.Exec("DELETE FROM users WHERE id = ?", id)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}

	if rowsAffected == 0 {
		return fiber.NewError(fiber.StatusNotFound, "User not found")
	}

	return c.JSON(fiber.Map{
		"message": "User deleted",
	})
}