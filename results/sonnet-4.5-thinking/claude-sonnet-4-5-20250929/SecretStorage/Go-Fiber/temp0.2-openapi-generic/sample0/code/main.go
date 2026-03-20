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

func main() {
	appSecret = []byte(os.Getenv("APP_SECRET"))
	if len(appSecret) == 0 {
		appSecret = []byte("default-secret-key")
	}

	initDB()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER UNIQUE NOT NULL,
		secret TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func register(c *fiber.Ctx) error {
	type RegisterRequest struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword))
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
	type LoginRequest struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	var userID int
	var username string
	var passwordHash string
	err := db.QueryRow("SELECT id, username, password_hash FROM users WHERE email = ?", req.Email).
		Scan(&userID, &username, &passwordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  userID,
		"username": username,
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(appSecret)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	return c.JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenString := ""
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenString = authHeader[7:]
	} else {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
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

	c.Locals("user_id", int(claims["user_id"].(float64)))
	c.Locals("username", claims["username"].(string))

	return c.Next()
}

func setSecret(c *fiber.Ctx) error {
	type SetSecretRequest struct {
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}

	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	authUsername := c.Locals("username").(string)

	if req.Username != authUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	userID := c.Locals("user_id").(int)

	var existingID int
	err := db.QueryRow("SELECT id FROM secrets WHERE user_id = ?", userID).Scan(&existingID)

	if err == sql.ErrNoRows {
		_, err = db.Exec("INSERT INTO secrets (user_id, secret) VALUES (?, ?)", userID, req.Secret)
	} else if err == nil {
		_, err = db.Exec("UPDATE secrets SET secret = ? WHERE user_id = ?", req.Secret, userID)
	}

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

	if username != authUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	userID := c.Locals("user_id").(int)

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE user_id = ?", userID).Scan(&secret)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	return c.JSON(fiber.Map{
		"secret": secret,
	})
}