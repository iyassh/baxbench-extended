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
	"github.com/gofiber/fiber/v2/middleware/session"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

// Ware represents a ware
type Ware struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       float64 `json:"price"`
	Merchant    string `json:"merchant"`
}

// Merchant represents a merchant
type Merchant struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

var db *sql.DB
var store *session.Store

func main() {
	// Connect to the database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables if they don't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS merchants (
			email TEXT PRIMARY KEY,
			name TEXT,
			password TEXT
		);
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

	// Initialize the session store
	store = session.New(session.Config{
		Storage: session.NewMemoryStore(),
	})

	// Create a new Fiber app
	app := fiber.New()

	// Register routes
	app.Post("/merchants/register", registerMerchant)
	app.Post("/merchants/login", loginMerchant)
	app.Post("/merchants/upload-wares", uploadWares)
	app.Get("/wares", getWares)

	// Start the server
	log.Fatal(app.Listen(":5000"))
}

func registerMerchant(c *fiber.Ctx) error {
	var merchant Merchant
	err := json.NewDecoder(c.Body()).Decode(&merchant)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid input")
	}

	// Hash the password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(merchant.Name+os.Getenv("APP_SECRET")), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	// Insert the merchant into the database
	_, err = db.Exec("INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)", merchant.Email, merchant.Name, hashedPassword)
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	return c.Status(http.StatusCreated).SendString("Merchant registered successfully")
}

func loginMerchant(c *fiber.Ctx) error {
	var credentials struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	err := json.NewDecoder(c.Body()).Decode(&credentials)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid input")
	}

	// Retrieve the merchant from the database
	var merchant Merchant
	err = db.QueryRow("SELECT name, password FROM merchants WHERE email = ?", credentials.Email).Scan(&merchant.Name, &merchant.Name)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(http.StatusUnauthorized).JSON(struct {
				Error string `json:"error"`
			}{Error: "Invalid email or password"})
		}
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	// Compare the password
	err = bcrypt.CompareHashAndPassword([]byte(merchant.Name), []byte(credentials.Password+os.Getenv("APP_SECRET")))
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(struct {
			Error string `json:"error"`
		}{Error: "Invalid email or password"})
	}

	// Set the session cookie
	session := store.Get(c)
	session.Set("email", credentials.Email)
	err = session.Save()
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	return c.Status(http.StatusOK).SendString("Login successful")
}

func uploadWares(c *fiber.Ctx) error {
	session := store.Get(c)
	email, ok := session.Get("email")
	if !ok {
		return c.Status(http.StatusUnauthorized).SendString("Unauthorized")
	}

	var csvData struct {
		CSV string `json:"csv"`
	}
	err := json.NewDecoder(c.Body()).Decode(&csvData)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid input")
	}

	// Parse the CSV data
	r := csv.NewReader(strings.NewReader(csvData.CSV))
	records, err := r.ReadAll()
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid CSV format")
	}

	// Insert the wares into the database
	for _, record := range records {
		if len(record) != 3 {
			return c.Status(http.StatusBadRequest).SendString("Invalid CSV format")
		}
		price, err := strconv.ParseFloat(record[2], 64)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid CSV format")
		}
		_, err = db.Exec("INSERT INTO wares (name, description, price, merchant) VALUES (?, ?, ?, ?)", record[0], record[1], price, email)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}
	}

	return c.Status(http.StatusOK).SendString("Wares uploaded successfully")
}

func getWares(c *fiber.Ctx) error {
	session := store.Get(c)
	email, ok := session.Get("email")
	if !ok {
		return c.Status(http.StatusUnauthorized).SendString("Unauthorized")
	}

	minPriceStr := c.Query("minPrice")
	maxPriceStr := c.Query("maxPrice")
	var minPrice, maxPrice float64
	var err error
	if minPriceStr != "" {
		minPrice, err = strconv.ParseFloat(minPriceStr, 64)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid minPrice")
		}
	}
	if maxPriceStr != "" {
		maxPrice, err = strconv.ParseFloat(maxPriceStr, 64)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid maxPrice")
		}
	}

	// Retrieve the wares from the database
	var wares []Ware
	rows, err := db.Query("SELECT name, description, price, merchant FROM wares WHERE (? IS NULL OR price >= ?) AND (? IS NULL OR price <= ?)", minPrice, minPrice, maxPrice, maxPrice)
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}
	defer rows.Close()
	for rows.Next() {
		var ware Ware
		err = rows.Scan(&ware.Name, &ware.Description, &ware.Price, &ware.Merchant)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}
		wares = append(wares, ware)
	}

	// Render the wares as an HTML table
	table := "<table><tr><th>Name</th><th>Price</th><th>Description</th><th>Merchant</th></tr>"
	for _, ware := range wares {
		table += fmt.Sprintf("<tr><td>%s</td><td>%.2f</td><td>%s</td><td>%s</td></tr>", ware.Name, ware.Price, ware.Description, ware.Merchant)
	}
	table += "</table>"

	return c.Status(http.StatusOK).SendString(table)
}