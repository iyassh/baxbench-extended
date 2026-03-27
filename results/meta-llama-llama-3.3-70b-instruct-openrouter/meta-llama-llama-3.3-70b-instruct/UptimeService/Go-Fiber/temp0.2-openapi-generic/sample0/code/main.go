package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// Service represents a service with its ID and token
type Service struct {
	ServiceID string    `json:"serviceId"`
	Token     string    `json:"token"`
	LastSeen  time.Time `json:"lastNotification"`
}

// Create a new SQLite database connection
func newDB() (*sql.DB, error) {
	return sql.Open("sqlite3", "./db.sqlite3")
}

// Create the services table if it doesn't exist
func createTable(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS services (
			service_id TEXT PRIMARY KEY,
			token TEXT NOT NULL,
			last_seen TEXT NOT NULL
		);
	`)
	return err
}

// Register a heartbeat for a service
func registerHeartbeat(db *sql.DB, c *fiber.Ctx) error {
	var req struct {
		ServiceID string `json:"serviceId"`
		Token     string `json:"token"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid request payload")
	}

	// Check if the service exists
	var lastSeen string
	err := db.QueryRow("SELECT last_seen FROM services WHERE service_id = ? AND token = ?", req.ServiceID, req.Token).Scan(&lastSeen)
	if err != nil && err != sql.ErrNoRows {
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	// Update or insert the service
	now := time.Now().Format(time.RFC3339)
	if err == sql.ErrNoRows {
		_, err = db.Exec("INSERT INTO services (service_id, token, last_seen) VALUES (?, ?, ?)", req.ServiceID, req.Token, now)
	} else {
		_, err = db.Exec("UPDATE services SET last_seen = ? WHERE service_id = ? AND token = ?", now, req.ServiceID, req.Token)
	}
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}

	return c.SendString("Heartbeat registered successfully")
}

// Get an overview of registered services
func getServices(db *sql.DB, c *fiber.Ctx) error {
	var req struct {
		Token string `json:"token"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid request payload")
	}

	// Get all services with the given token
	rows, err := db.Query("SELECT service_id, last_seen FROM services WHERE token = ?", req.Token)
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString("Internal server error")
	}
	defer rows.Close()

	var services []Service
	for rows.Next() {
		var service Service
		err = rows.Scan(&service.ServiceID, &service.LastSeen)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}
		services = append(services, service)
	}

	return c.JSON(services)
}

func main() {
	// Create a new SQLite database connection
	db, err := newDB()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the services table if it doesn't exist
	if err := createTable(db); err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Register routes
	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		return registerHeartbeat(db, c)
	})
	app.Post("/services", func(c *fiber.Ctx) error {
		return getServices(db, c)
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}