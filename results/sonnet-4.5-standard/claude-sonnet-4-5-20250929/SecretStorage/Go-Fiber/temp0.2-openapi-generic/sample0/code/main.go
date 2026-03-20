<CODE>
package main

import (
	"database/sql"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret []byte

type User struct {
	ID       int
	Email    string
	Username string
	Password string
}

type Secret struct {
	ID       int
	Username string
	Secret   string
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SetSecretRequest struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`

	createSecretsTable := `
	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		secret TEXT NOT NULL
	);`

	_, err = db.Exec(createUsersTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createSecretsTable)
	if err != nil {
		return err
	}

	return nil
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(email string, username string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email":    email,
		"username": username,
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(appSecret)
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenString := authHeader
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenString = authHeader[7:]
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return appSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("email", claims["email"])
	c.Locals("username", claims["username"])

	return c.Next()
}

func register(c *fiber.Ctx) error {
	req := new(RegisterRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
		req.Email, req.Username, hashedPassword)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	req := new(LoginRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	var user User
	err := db.QueryRow("SELECT id, email, username, password FROM users WHERE email = ?",
		req.Email).Scan(&user.ID, &user.Email, &user.Username, &user.Password)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	token, err := generateJWT(user.Email, user.Username)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	return c.JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func setSecret(c *fiber.Ctx) error {
	req := new(SetSecretRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	username := c.Locals("username").(string)
	if username != req.Username {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	_, err := db.Exec("INSERT INTO secrets (username, secret) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET secret = ?",
		req.Username, req.Secret, req.Secret)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	authUsername := c.Locals("username").(string)
	if authUsername != username {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username).Scan(&secret)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	return c.JSON(fiber.Map{
		"secret": secret,
	})
}

func main() {
	appSecretStr := os.Getenv("APP_SECRET")
	if appSecretStr == "" {
		appSecretStr = "default-secret-key-change-in-production"
	}
	appSecret = []byte(appSecretStr)

	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>