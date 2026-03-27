package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginData struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SecretData struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

type Secret struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

type JWTClaim struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

var db *sql.DB
var secret string

func main() {
	app := fiber.New()

	db, _ = sql.Open("sqlite3", "./db.sqlite3")
	secret = os.Getenv("APP_SECRET")

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", setSecret)
	app.Get("/get_secret", getSecret)

	app.Listen(":5000")
}

func register(c *fiber.Ctx) error {
	user := new(User)

	if err := json.Unmarshal(c.Body(), user); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid data"})
	}

	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(user.Password), 12)
	user.Password = string(hashedPassword)

	_, err := db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)", user.Email, user.Username, user.Password)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	loginData := new(LoginData)

	if err := json.Unmarshal(c.Body(), loginData); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid data"})
	}

	row := db.QueryRow("SELECT password FROM users WHERE email = ?", loginData.Email)
	var hashedPassword string
	err := row.Scan(&hashedPassword)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	if err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(loginData.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	claims := JWTClaim{
		Username: loginData.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "user",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedToken, _ := token.SignedString([]byte(secret))

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"token": signedToken, "message": "Login successful"})
}

func setSecret(c *fiber.Ctx) error {
	secretData := new(SecretData)

	if err := json.Unmarshal(c.Body(), secretData); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid data"})
	}

	tokenString := c.Get("Authorization")
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaim{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	claims := token.Claims.(*JWTClaim)
	if claims.Username != secretData.Username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	_, err = db.Exec("INSERT INTO secrets (username, secret) VALUES (?, ?)", secretData.Username, secretData.Secret)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")

	tokenString := c.Get("Authorization")
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaim{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	claims := token.Claims.(*JWTClaim)
	if claims.Username != username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	row := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username)
	var secret Secret
	err = row.Scan(&secret.Secret)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	return c.Status(fiber.StatusOK).JSON(secret)
}