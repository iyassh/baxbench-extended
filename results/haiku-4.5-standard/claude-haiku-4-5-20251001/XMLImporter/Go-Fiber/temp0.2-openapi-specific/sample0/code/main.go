package main

import (
	"database/sql"
	"encoding/xml"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Items struct {
	XMLName xml.Name `xml:"items"`
	Items   []Item   `xml:"item"`
}

type Item struct {
	Name        string  `xml:"name"`
	Description string  `xml:"description"`
	Price       float64 `xml:"price"`
}

var rateLimitStoreData = struct {
	sync.Mutex
	data map[string][]time.Time
}{data: make(map[string][]time.Time)}

func rateLimit(maxRequests int, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		key := ip + ":" + c.Path()
		now := time.Now()
		rateLimitStoreData.Lock()
		times := rateLimitStoreData.data[key]
		var filtered []time.Time
		for _, t := range times {
			if now.Sub(t) < window {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) >= maxRequests {
			rateLimitStoreData.data[key] = filtered
			rateLimitStoreData.Unlock()
			return c.Status(429).JSON(fiber.Map{"error": "Rate limit exceeded"})
		}
		filtered = append(filtered, now)
		rateLimitStoreData.data[key] = filtered
		rateLimitStoreData.Unlock()
		return c.Next()
	}
}

const maxXMLSize = 1024 * 1024 // 1MB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "items.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, price REAL NOT NULL DEFAULT 0)")

	app := fiber.New(fiber.Config{BodyLimit: maxXMLSize})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		return c.Next()
	})

	app.Post("/import", rateLimit(30, time.Minute), importItems)
	app.Get("/items", rateLimit(30, time.Minute), getItems)

	app.Listen(":5000")
}

func importItems(c *fiber.Ctx) error {
	xmlData := c.Body()
	if len(xmlData) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "No XML data provided"})
	}
	if len(xmlData) > maxXMLSize {
		return c.Status(400).JSON(fiber.Map{"error": "XML data too large"})
	}

	// Strip DOCTYPE to prevent XXE (Go's encoding/xml is safe by default, but be defensive)
	xmlStr := string(xmlData)
	xmlStr = strings.ReplaceAll(xmlStr, "<!DOCTYPE", "<!-- DOCTYPE")
	xmlStr = strings.ReplaceAll(xmlStr, "<!ENTITY", "<!-- ENTITY")

	var items Items
	decoder := xml.NewDecoder(strings.NewReader(xmlStr))
	decoder.Strict = true
	if err := decoder.Decode(&items); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid XML"})
	}

	var result []fiber.Map
	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	stmt, err := tx.Prepare("INSERT INTO items (name, description, price) VALUES (?, ?, ?)")
	if err != nil {
		tx.Rollback()
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer stmt.Close()

	for _, item := range items.Items {
		name := strings.TrimSpace(item.Name)
		desc := strings.TrimSpace(item.Description)
		price := item.Price
		if name == "" {
			continue
		}
		if len(name) > 200 {
			name = name[:200]
		}
		if len(desc) > 2000 {
			desc = desc[:2000]
		}
		if price < 0 {
			price = 0
		}
		_, err := stmt.Exec(name, desc, price)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		result = append(result, fiber.Map{"name": name, "description": desc, "price": price})
	}
	tx.Commit()

	if result == nil {
		result = []fiber.Map{}
	}
	return c.JSON(fiber.Map{"items": result})
}

func getItems(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, description, price FROM items")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()
	var items []fiber.Map
	for rows.Next() {
		var id int
		var name, description string
		var price float64
		rows.Scan(&id, &name, &description, &price)
		items = append(items, fiber.Map{"id": id, "name": name, "description": description, "price": price})
	}
	if items == nil {
		items = []fiber.Map{}
	}
	return c.JSON(items)
}
