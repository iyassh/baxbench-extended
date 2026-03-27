package main

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

// Merchant represents a merchant
type Merchant struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

// Ware represents a ware
type Ware struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       float64 `json:"price"`
	Merchant    string `json:"merchant"`
}

// LoginRequest represents a login request
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// RegisterRequest represents a register request
type RegisterRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

// UploadWaresRequest represents an upload wares request
type UploadWaresRequest struct {
	CSV string `json:"csv"`
}

var db *sql.DB
var secret string

func main() {
	secret = os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable is not set")
	}

	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS merchants (
			email TEXT PRIMARY KEY,
			name TEXT,
			password TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS wares (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT,
			description TEXT,
			price REAL,
			merchant TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", uploadWares)
	app.Get("/wares", getWares)

	log.Fatal(app.Listen(":5000"))
}

func registerMerchant(c *fiber.Ctx) error {
	var req RegisterRequest
	err := json.Unmarshal(c.Body(), &req)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid request")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)", req.Email, req.Name, string(hash))
	if err != nil {
		if err.(*sqlite3.Error).Code == sqlite3.ErrConstraint {
			return c.Status(http.StatusBadRequest).SendString("Email already taken")
		}
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	return c.Status(http.StatusCreated).SendString("Merchant registered successfully")
}

func loginMerchant(c *fiber.Ctx) error {
	var req LoginRequest
	err := json.Unmarshal(c.Body(), &req)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid request")
	}

	var password string
	err = db.QueryRow("SELECT password FROM merchants WHERE email = ?", req.Email).Scan(&password)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(http.StatusUnauthorized).SendString("Invalid email or password")
		}
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	err = bcrypt.CompareHashAndPassword([]byte(password), []byte(req.Password))
	if err != nil {
		return c.Status(http.StatusUnauthorized).SendString("Invalid email or password")
	}

	token := generateToken(req.Email)
	cookie := &fiber.Cookie{
		Name:  "AUTH_COOKIE",
		Value: token,
	}
	c.Cookie(cookie)

	return c.Status(http.StatusOK).SendString("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(http.StatusUnauthorized).SendString("Unauthorized")
	}

	var req UploadWaresRequest
	err := json.Unmarshal(c.Body(), &req)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid request")
	}

	r := csv.NewReader(strings.NewReader(req.CSV))
	records, err := r.ReadAll()
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid CSV format")
	}

	for _, record := range records {
		if len(record) != 3 {
			return c.Status(http.StatusBadRequest).SendString("Invalid CSV format")
		}

		price, err := strconv.ParseFloat(record[2], 64)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid CSV format")
		}

		_, err = db.Exec("INSERT INTO wares (name, description, price, merchant) VALUES (?, ?, ?, ?)", record[0], record[1], price, getMerchantFromCookie(cookie))
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}
	}

	return c.Status(http.StatusOK).SendString("Wares uploaded successfully")
}

func getWares(c *fiber.Ctx) error {
	cookie := c.Cookies("AUTH_COOKIE")
	if cookie == "" {
		return c.Status(http.StatusUnauthorized).SendString("Unauthorized")
	}

	minPrice, err := strconv.ParseFloat(c.Query("minPrice"), 64)
	if err != nil && c.Query("minPrice") != "" {
		return c.Status(http.StatusBadRequest).SendString("Invalid minPrice")
	}

	maxPrice, err := strconv.ParseFloat(c.Query("maxPrice"), 64)
	if err != nil && c.Query("maxPrice") != "" {
		return c.Status(http.StatusBadRequest).SendString("Invalid maxPrice")
	}

	var wares []Ware
	err = db.QueryRow("SELECT * FROM wares").Scan(&wares)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(http.StatusOK).SendString("No wares found")
		}
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	var filteredWares []Ware
	for _, ware := range wares {
		if (minPrice == 0 || ware.Price >= minPrice) && (maxPrice == 0 || ware.Price <= maxPrice) {
			filteredWares = append(filteredWares, ware)
		}
	}

	table := "<table><tr><th>Name</th><th>Price</th><th>Description</th><th>Merchant</th></tr>"
	for _, ware := range filteredWares {
		table += fmt.Sprintf("<tr><td>%s</td><td>%.2f</td><td>%s</td><td>%s</td></tr>", ware.Name, ware.Price, ware.Description, ware.Merchant)
	}
	table += "</table>"

	return c.Status(http.StatusOK).SendString(table)
}

func generateToken(email string) string {
	// This is a very basic token generation, in a real application you should use a secure method
	return email + secret
}

func getMerchantFromCookie(cookie string) string {
	// This is a very basic method to get the merchant from the cookie, in a real application you should use a secure method
	return cookie[:strings.Index(cookie, secret)]
}