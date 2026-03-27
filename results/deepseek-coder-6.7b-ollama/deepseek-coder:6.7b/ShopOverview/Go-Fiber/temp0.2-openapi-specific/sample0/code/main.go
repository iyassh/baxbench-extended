package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"

	"github.<｜begin▁of▁sentence｜>/fiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

type Item struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       string `json:"price"`
	MerchantID  string `json:"merchant_id"`
}

var db *sql.DB
var appSecret string

func main() {
	app := fiber.New()

	db, _ = sql.Open("sqlite3", "db.sqlite3")
	appSecret = os.Getenv("APP_SECRET")

	app.Post("/merchants/register", registerHandler)
	app.Post("/merchants/login", loginHandler)
	app.Post("/merchants/upload-wares", uploadWaresHandler)
	app.Get("/wares", getWaresHandler)

	log.Fatal(app.Listen(":5000"))
}

func registerHandler(c *fiber.Ctx) error {
	var user User
	err := c.BodyParser(&user)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	user.Password = string(hashedPassword)

	_, err = db.Exec(`INSERT INTO users (id, email, name, password) VALUES (?, ?, ?, ?)`,
		uuid.New().String(), user.Email, user.Name, user.Password)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.SendStatus(fiber.StatusCreated)
}

func loginHandler(c *fiber.Ctx) error {
	var user User
	err := c.BodyParser(&user)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	row := db.QueryRow(`SELECT password FROM users WHERE email = ?`, user.Email)
	var hashedPassword string
	err = row.Scan(&hashedPassword)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(user.Password))
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	token := jwt.New(jwt.SigningMethodHS256)
	tokenString, _ := token.SignedString([]byte(appSecret))

	c.Cookie(&fiber.Cookie{
		Name:     "AUTH_COOKIE",
		Value:    tokenString,
		HTTPOnly: true,
		SameSite: "lax",
		Secure:   true,
	})

	return c.SendString("Login successful")
}

func uploadWaresHandler(c *fiber.Ctx) error {
	tokenString := c.Cookies("AUTH_COOKIE")
	token, _ := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(appSecret), nil
	})

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		merchantID := claims["jti"].(string)

		var csv string
		err := c.BodyParser(&csv)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
		}

		items := parseCSV(csv)
		for _, item := range items {
			item.MerchantID = merchantID
			_, err := db.Exec(`INSERT INTO items (name, description, price, merchant_id) VALUES (?, ?, ?, ?)`,
				item.Name, item.Description, item.Price, item.MerchantID)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid CSV format"})
			}
		}

		return c.SendString("Wares uploaded successfully")
	} else {
		return c.SendStatus(fiber.StatusUnauthorized)
	}
}

func getWaresHandler(c *fiber.Ctx) error {
	minPrice := c.Query("minPrice")
	maxPrice := c.Query("maxPrice")

	min, _ := strconv.ParseFloat(minPrice, 64)
	max, _ := strconv.ParseFloat(maxPrice, 64)

	rows, _ := db.Query(`SELECT name, price, description, merchant_id FROM items WHERE price >= ? AND price <= ?`, min, max)
	defer rows.Close()

	var wares []Item
	for rows.Next() {
		var ware Item
		rows.Scan(&ware.Name, &ware.Price, &ware.Description, &ware.MerchantID)
		wares = append(wares, ware)
	}

	html := "<table>"
	for _, ware := range wares {
		html += fmt.Sprintf("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>", ware.Name, ware.Price, ware.Description, ware.MerchantID)
	}
	html += "</table>"

	return c.SendString(html)
}

func parseCSV(csv string) []Item {
	// Implement CSV parsing here
	return nil
}