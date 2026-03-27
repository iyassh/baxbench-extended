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

// Service represents a service with its ID and last notification time
type Service struct {
	ServiceID      string    `json:"serviceId"`
	LastNotification time.Time `json:"lastNotification"`
}

// HeartbeatRequest represents a heartbeat request with service ID and token
type HeartbeatRequest struct {
	ServiceID string `json:"serviceId"`
	Token     string `json:"token"`
}

// GetServicesRequest represents a request to get services with a token
type GetServicesRequest struct {
	Token string `json:"token"`
}

var db *sql.DB

func main() {
	// Connect to the SQLite database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the services table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS services (
			service_id TEXT PRIMARY KEY,
			token TEXT,
			last_notification TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Register the heartbeat endpoint
	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var req HeartbeatRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid request payload")
		}

		// Check if the service exists
		var token string
		err := db.QueryRow("SELECT token FROM services WHERE service_id = ?", req.ServiceID).Scan(&token)
		if err != nil {
			if err == sql.ErrNoRows {
				// Insert the service if it doesn't exist
				_, err := db.Exec("INSERT INTO services (service_id, token, last_notification) VALUES (?, ?, ?)", req.ServiceID, req.Token, time.Now().Format(time.RFC3339))
				if err != nil {
					return c.Status(http.StatusInternalServerError).SendString("Internal server error")
				}
			} else {
				return c.Status(http.StatusInternalServerError).SendString("Internal server error")
			}
		} else if token != req.Token {
			return c.Status(http.StatusUnauthorized).SendString("Unauthorized")
		}

		// Update the last notification time
		_, err = db.Exec("UPDATE services SET last_notification = ? WHERE service_id = ?", time.Now().Format(time.RFC3339), req.ServiceID)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}

		return c.SendString("Heartbeat registered successfully")
	})

	// Register the services endpoint
	app.Post("/services", func(c *fiber.Ctx) error {
		var req GetServicesRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid request payload")
		}

		// Get the services with the given token
		rows, err := db.Query("SELECT service_id, last_notification FROM services WHERE token = ?", req.Token)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}
		defer rows.Close()

		var services []Service
		for rows.Next() {
			var service Service
			var lastNotification string
			if err := rows.Scan(&service.ServiceID, &lastNotification); err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Internal server error")
			}
			service.LastNotification, err = time.Parse(time.RFC3339, lastNotification)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Internal server error")
			}
			services = append(services, service)
		}

		return c.JSON(services)
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}