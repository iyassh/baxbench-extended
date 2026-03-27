package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var hmacSampleSecret []byte

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		panic(err)
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT UNIQUE,
			password TEXT,
			name TEXT
		)
	`)
	if err != nil {
		panic(err)
	}
	hmacSampleSecret = []byte(os.Getenv("APP_SECRET"))
	app := fiber.New()
	app.Post("/login", login)
	app.Post("/register", register)
	app.Listen(":5000")
}

func login(c *fiber.Ctx) error {
	type Login struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	var loginData Login
	err := c.BodyParser(&loginData)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	row := db.QueryRow("SELECT * FROM users WHERE email = ?", loginData.Email)
	var user User
	err = row.Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid email or password"})
	}
	if loginData.Password != user.Password {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid email or password"})
	}
	token := jwt.New(jwt.SigningMethodHS256)
	claims := token.Claims.(jwt.MapClaims)
	claims["sub"] = user.ID
	claims["exp"] = time.Now().Add(time.Hour * 24).Unix()
	t, err := token.SignedString(hmacSampleSecret)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"token": t, "message": "Login successful"})
}

func register(c *fiber.Ctx) error {
	type Register struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	var registerData Register
	err := c.BodyParser(&registerData)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	_, err = db.Exec("INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)", uuid.New().String(), registerData.Email, registerData.Password, registerData.Name)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Registration successful"})
}