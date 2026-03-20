package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId"`
	Token     string `json:"token"`
}

type ServicesRequest struct {
	Token string `json:"token"`
}

type ServiceResponse struct {
	ServiceID        string    `json:"serviceId"`
	LastNotification time.Time `json:"lastNotification"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT NOT NULL,
		token TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		PRIMARY KEY (service_id, token)
	);`

	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var req HeartbeatRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		if req.ServiceID == "" || req.Token == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
		}

		now := time.Now()
		
		_, err := db.Exec(`
			INSERT INTO services (service_id, token, last_notification) 
			VALUES (?, ?, ?)
			ON CONFLICT(service_id, token) 
			DO UPDATE SET last_notification = ?`,
			req.ServiceID, req.Token, now, now)
		
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.SendStatus(200)
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		var req ServicesRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
		}

		if req.Token == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Missing token"})
		}

		rows, err := db.Query(`
			SELECT service_id, last_notification 
			FROM services 
			WHERE token = ?
			ORDER BY service_id`,
			req.Token)
		
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer rows.Close()

		var services []ServiceResponse
		for rows.Next() {
			var service ServiceResponse
			err := rows.Scan(&service.ServiceID, &service.LastNotification)
			if err != nil {
				log.Printf("Scan error: %v", err)
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			services = append(services, service)
		}

		if services == nil {
			services = []ServiceResponse{}
		}

		return c.JSON(services)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}