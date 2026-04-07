package main

import (
	"database/sql"
	"encoding/xml"
	"log"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

var doctypeRegex = regexp.MustCompile(`(?is)<!DOCTYPE[^>]*(?:\[[^\]]*\])?\s*>`)
var entityRegex = regexp.MustCompile(`(?is)<!ENTITY[^>]*>`)
var systemRegex = regexp.MustCompile(`(?is)SYSTEM\s+["'][^"']*["']`)
var publicRegex = regexp.MustCompile(`(?is)PUBLIC\s+["'][^"']*["']`)

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

type rateLimitEntry struct {
	timestamps []time.Time
	mu         sync.Mutex
}

var rateLimitStore sync.Map

func rateLimit(maxReqs int, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		now := time.Now()
		val, _ := rateLimitStore.LoadOrStore(ip, &rateLimitEntry{})
		entry := val.(*rateLimitEntry)
		entry.mu.Lock()
		defer entry.mu.Unlock()
		filtered := make([]time.Time, 0)
		for _, t := range entry.timestamps {
			if now.Sub(t) < window {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) >= maxReqs {
			return c.Status(429).JSON(fiber.Map{"error": "Rate limit exceeded"})
		}
		entry.timestamps = append(filtered, now)
		return c.Next()
	}
}

func sanitizeString(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) > maxLen {
		return s[:maxLen]
	}
	return s
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "xmlimporter.db?_journal_mode=WAL&_foreign_keys=on")
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

	app := fiber.New(fiber.Config{BodyLimit: 500 * 1024})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Set("Referrer-Policy", "no-referrer")
		c.Set("Cache-Control", "no-store")
		return c.Next()
	})

	app.Post("/import", rateLimit(20, time.Minute), importXML)
	app.Get("/items", listItems)

	log.Fatal(app.Listen(":5000"))
}

func importXML(c *fiber.Ctx) error {
	xmlData := string(c.Body())
	if len(xmlData) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "No XML data provided"})
	}

	// Strip DOCTYPE, ENTITY, SYSTEM, PUBLIC declarations
	xmlData = doctypeRegex.ReplaceAllString(xmlData, "")
	xmlData = entityRegex.ReplaceAllString(xmlData, "")
	xmlData = systemRegex.ReplaceAllString(xmlData, "")
	xmlData = publicRegex.ReplaceAllString(xmlData, "")

	var items Items
	if err := xml.Unmarshal([]byte(xmlData), &items); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid or malicious XML"})
	}

	result := []fiber.Map{}
	maxItems := 1000
	count := 0

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	for _, item := range items.Items {
		if count >= maxItems {
			break
		}
		name := sanitizeString(item.Name, 500)
		if name == "" {
			continue
		}
		description := sanitizeString(item.Description, 2000)
		price, err := strconv.ParseFloat(strings.TrimSpace(item.Price), 64)
		if err != nil || price < 0 || price > 1_000_000 || math.IsNaN(price) || math.IsInf(price, 0) {
			price = 0
		}

		res, err := tx.Exec("INSERT INTO items (name, description, price) VALUES (?, ?, ?)", name, description, price)
		if err != nil {
			continue
		}
		id, _ := res.LastInsertId()
		result = append(result, fiber.Map{"id": id, "name": name, "description": description, "price": price})
		count++
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
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
