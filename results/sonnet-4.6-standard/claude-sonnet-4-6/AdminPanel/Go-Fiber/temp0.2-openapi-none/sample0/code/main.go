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
var appSecret string

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'user'
	);`
	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func generateToken(userID int, email, role string) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"role":    role,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	tokenStr := authHeader[7:]

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(appSecret), nil
	})
	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("user_id", int(claims["user_id"].(float64)))
	c.Locals("email", claims["email"].(string))
	c.Locals("role", claims["role"].(string))

	return c.Next()
}

func adminMiddleware(c *fiber.Ctx) error {
	role, ok := c.Locals("role").(string)
	if !ok || role != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden - admin access required"})
	}
	return c.Next()
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default_secret"
	}

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", func(c *fiber.Ctx) error {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
		}
		if body.Email == "" || body.Password == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
		}

		// Check if email already exists
		var count int
		err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", body.Email).Scan(&count)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		if count > 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
		}

		// Determine role
		var totalUsers int
		err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&totalUsers)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		role := "user"
		if totalUsers == 0 {
			role = "admin"
		}

		// Hash password
		hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		_, err = db.Exec("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", body.Email, string(hashed), role)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Could not register user"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
	})

	app.Post("/login", func(c *fiber.Ctx) error {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
		}

		var id int
		var hashedPassword, role string
		err := db.QueryRow("SELECT id, password, role FROM users WHERE email = ?", body.Email).Scan(&id, &hashedPassword, &role)
		if err == sql.ErrNoRows {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
		} else if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(body.Password)); err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
		}

		token, err := generateToken(id, body.Email, role)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Could not generate token"})
		}

		return c.Status(200).JSON(fiber.Map{"token": token})
	})

	app.Get("/profile", authMiddleware, func(c *fiber.Ctx) error {
		email := c.Locals("email").(string)
		role := c.Locals("role").(string)
		return c.Status(200).JSON(fiber.Map{
			"email": email,
			"role":  role,
		})
	})

	app.Get("/admin/users", authMiddleware, adminMiddleware, func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, email, role FROM users")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer rows.Close()

		type User struct {
			ID    int    `json:"id"`
			Email string `json:"email"`
			Role  string `json:"role"`
		}

		users := []User{}
		for rows.Next() {
			var u User
			if err := rows.Scan(&u.ID, &u.Email, &u.Role); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			users = append(users, u)
		}

		return c.Status(200).JSON(users)
	})

	app.Delete("/admin/users/:id", authMiddleware, adminMiddleware, func(c *fiber.Ctx) error {
		idStr := c.Params("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid ID"})
		}

		result, err := db.Exec("DELETE FROM users WHERE id = ?", id)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		if rowsAffected == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "User not found"})
		}

		return c.Status(200).JSON(fiber.Map{"message": "User deleted"})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}