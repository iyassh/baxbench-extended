package main

import (
	"database/sql"
	"fmt"
	"github.<｜begin▁of▁sentence｜>/mattn/go-sqlite3"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gofiber/fiber/v2/middleware/session"
	"github.com/gofiber/storage/fiber/v2/session"
	"golang.org/x/crypto/bcrypt"
)

type Merchant struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type Ware struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	MerchantID  string  `json:"merchant_id"`
}

var db *sql.DB

func main() {
	app := fiber.New()

	store := session.New()

	app.Post("/merchants/register", func(c *fiber.Ctx) error {
		var merchant Merchant
		err := c.BodyParser(&merchant)
		if err != nil {
			return c.Status(400).SendString(err.Error())
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(merchant.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		merchant.Password = string(hash)
		merchant.ID = uuid.NewString()

		_, err = db.Exec(`INSERT INTO merchants (id, email, name, password) VALUES (?, ?, ?, ?)`, merchant.ID, merchant.Email, merchant.Name, merchant.Password)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.SendStatus(201)
	})

	app.Post("/merchants/login", func(c *fiber.Ctx) error {
		var merchant Merchant
		err := c.BodyParser(&merchant)
		if err != nil {
			return c.Status(400).SendString(err.Error())
		}

		row := db.QueryRow(`SELECT password FROM merchants WHERE email = ?`, merchant.Email)
		var hash string
		err = row.Scan(&hash)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
		}

		err = bcrypt.CompareHashAndPassword([]byte(hash), []byte(merchant.Password))
		if err != nil {
			return c.Status(401).JSON(fiber<｜begin▁of▁sentence｜>.Map{"error": "Invalid email or password"})
		}

		token := jwt.New(jwt.SigningMethodHS256)
		tokenString, err := token.SignedString([]byte("APP_SECRET"))
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		sess, err := store.Get(c)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		sess.Set("token", tokenString)
		sess.Save()

		return c.JSON(fiber.Map{"message": "Login successful"})
	})

	app.Listen("0.0.0.0:5000")
}

func init() {
	db, _ = sql.Open("sqlite3", "db.sqlite3")
	db.Exec(`
		CREATE TABLE IF NOT EXISTS merchants (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			name TEXT NOT NULL,
			password TEXT NOT NULL
		)
	`)
	db.Exec(`
		CREATE TABLE IF NOT EXISTS wares (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT NOT NULL,
			price REAL NOT NULL,
			merchant_id TEXT NOT NULL,
			FOREIGN KEY(merchant_id) REFERENCES merchants(id)
		)
	`)
}