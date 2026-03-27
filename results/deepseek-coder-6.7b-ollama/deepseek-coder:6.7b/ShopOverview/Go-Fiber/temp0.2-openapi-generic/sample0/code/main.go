package main

import (
	"database/sql"
	"fmt"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/session"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var store *session.Store

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type Ware struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	MerchantID  string  `json:"merchant_id"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		fmt.Println(err)
		return
	}
	defer db.Close()

	store = session.New()

	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", uploadWares)
	app.Get("/wares", getWares)

	app.Listen(":5000")
}

func registerMerchant(c *fiber.Ctx) error {
	var user User
	err := c.BodyParser(&user)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	_, err = db.Exec("INSERT INTO users (id, email, password) VALUES (?, ?, ?)", uuid.New().String(), user.Email, hashedPassword)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	return c.SendStatus(fiber.StatusCreated)
}

func loginMerchant(c *fiber.Ctx) error {
	var user User
	err := c.BodyParser(&user)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	var dbPassword string
	err = db.QueryRow("SELECT password FROM users WHERE email = ?", user.Email).Scan(&dbPassword)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(dbPassword), []byte(user.Password))
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	sess, err := store.Get(c)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	sess.Set("email", user.Email)
	err = sess.Save()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    sess.ID(),
		HTTPOnly: true,
		SameSite: "lax",
	})

	return c.JSON("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	sess, err := store.Get(c)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	email, ok := sess.Get("email").(string)
	if !ok {
		return c.SendStatus(fiber.StatusUnauthorized)
	}

	var merchantID string
	err = db.QueryRow("SELECT id FROM users WHERE email = ?", email).Scan(&merchantID)
	if err != nil {
		return c.SendStatus(fiber.StatusUnauthorized)
	}

	var ware Ware
	err = c.BodyParser(&ware)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	csvRows := strings.Split(ware.CSV, "\n")
	for _, row := range csvRows[1:] {
		columns := strings.Split(row, ",")
		if len(columns) != 3 {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		_, err = db.Exec("INSERT INTO wares (name, description, price, merchant_id) VALUES (?, ?, ?, ?)", columns[0], columns[1], columns[2], merchantID)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}
	}

	return c.SendStatus(fiber.StatusOK)
}

func getWares(c *fiber.Ctx) error {
	sess, err := store.Get(c)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	_, ok := sess.Get("email").(string)
	if !ok {
		return c.SendStatus(fiber.StatusUnauthorized)
	}

	minPrice := c.Query("minPrice")
	maxPrice := c.Query("maxPrice")

	rows, err := db.Query("SELECT name, price, description, email FROM wares INNER JOIN users ON wares.merchant_id = users.id WHERE price >= ? AND price <= ?", minPrice, maxPrice)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	var wares []Ware
	for rows.Next() {
		var ware Ware
		err = rows.Scan(&ware.Name, &ware.Price, &ware.Description, &ware.MerchantID)
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}

		wares = append(wares, ware)
	}

	err = rows.Err()
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.Render("wares", fiber.Map{"wares": wares})
}