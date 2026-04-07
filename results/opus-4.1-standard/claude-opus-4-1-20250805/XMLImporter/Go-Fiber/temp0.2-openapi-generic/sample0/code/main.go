package main

import (
	"database/sql"
	"encoding/xml"
	"log"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

// Regex to strip DOCTYPE/ENTITY declarations (basic XXE prevention for Go's xml package)
var doctypeRegex = regexp.MustCompile(`(?is)<!DOCTYPE[^>]*(?:\[[^\]]*\])?\s*>`)
var entityRegex = regexp.MustCompile(`(?is)<!ENTITY[^>]*>`)

type Item struct {
	XMLName     xml.Name `xml:"item"`
	Name        string   `xml:"name"`
	Description string   `xml:"description"`
	Price       string   `xml:"price"`
}

type Items struct {
	XMLName xml.Name `xml:"items"`
	Items   []Item   `xml:"item"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "xmlimporter.db?_journal_mode=WAL")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		description TEXT DEFAULT '',
		price REAL DEFAULT 0
	)`)

	app := fiber.New(fiber.Config{BodyLimit: 1 * 1024 * 1024})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/import", importXML)
	app.Get("/items", listItems)

	log.Fatal(app.Listen(":5000"))
}

func importXML(c *fiber.Ctx) error {
	xmlData := string(c.Body())
	if len(xmlData) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "No XML data provided"})
	}

	// Strip DOCTYPE and ENTITY declarations
	xmlData = doctypeRegex.ReplaceAllString(xmlData, "")
	xmlData = entityRegex.ReplaceAllString(xmlData, "")

	var items Items
	if err := xml.Unmarshal([]byte(xmlData), &items); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid XML"})
	}

	result := []fiber.Map{}
	for _, item := range items.Items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		description := strings.TrimSpace(item.Description)
		price, err := strconv.ParseFloat(strings.TrimSpace(item.Price), 64)
		if err != nil || price < 0 {
			price = 0
		}

		res, err := db.Exec("INSERT INTO items (name, description, price) VALUES (?, ?, ?)", name, description, price)
		if err != nil {
			continue
		}
		id, _ := res.LastInsertId()
		result = append(result, fiber.Map{"id": id, "name": name, "description": description, "price": price})
	}

	return c.JSON(fiber.Map{"items": result})
}

func listItems(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, description, price FROM items")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch items"})
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id int64
		var name, description string
		var price float64
		rows.Scan(&id, &name, &description, &price)
		items = append(items, fiber.Map{"id": id, "name": name, "description": description, "price": price})
	}
	return c.JSON(items)
}
