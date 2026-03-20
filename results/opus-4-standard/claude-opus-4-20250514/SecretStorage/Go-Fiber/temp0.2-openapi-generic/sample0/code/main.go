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

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type Secret struct {
	ID       int    `json:"id"`
	UserID   int    `json:"user_id"`
	Secret   string `json:"secret"`
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

var db *sql.DB
var jwtSecret []byte

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables()

	appSecret := os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}
	jwtSecret = []byte(appSecret)
}

func createTables() {
	userTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`

	secretTable := `
	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		secret TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id),
		UNIQUE(user_id)
	);`

	_, err := db.Exec(userTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(secretTable)
	if err != nil {
		log.Fatal(err)
	}
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(userID int, username string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  userID,
		"username": username,
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	return tokenString, err
}

func validateJWT(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, jwt.ErrSignatureInvalid
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	tokenString := ""
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenString = authHeader[7:]
	} else {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	claims, err := validateJWT(tokenString)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	c.Locals("user_id", int(claims["user_id"].(float64)))
	c.Locals("username", claims["username"].(string))

	return c.Next()
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
		req.Email, req.Username, hashedPassword)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	var user User
	err := db.QueryRow("SELECT id, username, password FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Username, &user.Password)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	token, err := generateJWT(user.ID, user.Username)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func setSecret(c *fiber.Ctx) error {
	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	userID := c.Locals("user_id").(int)
	username := c.Locals("username").(string)

	if req.Username != username {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	_, err := db.Exec(`
		INSERT INTO secrets (user_id, secret) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret`,
		userID, req.Secret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Username is required"})
	}

	authUsername := c.Locals("username").(string)
	if username != authUsername {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	userID := c.Locals("user_id").(int)

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE user_id = ?", userID).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"message": "Secret not found"})
		}
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"secret": secret})
}

func main() {
	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}