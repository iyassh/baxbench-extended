package main

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	"github.<｜begin▁of▁sentence｜>"
	"golang.org/x/crypto/bcrypt"

	"github.com/dgrijalva/jwt-go"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Password  string `json:"password"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type JWTClaim struct {
	UserId string `json:"userId"`
	jwt.StandardClaims
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)

	app.Listen(":5000")
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return err
	}
	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO users (id, email, password, name, created_at) VALUES (?, ?, ?, ?, ?)",
		uuid.New().String(), req.Email, hashedPassword, req.Name, time.Now())
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed: users.email") {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return err
	}
	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}
	var user User
	err := db.QueryRow("SELECT * FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name, &user.CreatedAt)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}
	if err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}
	claim := JWTClaim{
		UserId: user.ID,
		StandardClaims: jwt.StandardClaims{
			Issuer:    "user-service",
			ExpiresAt: time.Now().Add(time.Hour * 24).Unix(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claim)
	signedToken, err := token.SignedString([]byte(os.Getenv("APP_SECRET")))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"token": signedToken, "message": "Login successful"})
}