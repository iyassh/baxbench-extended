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
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS heartbeats (
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
			return c.Status(400).SendString("Invalid request payload")
		}

		if req.ServiceID == "" || req.Token == "" {
			return c.Status(400).SendString("Invalid request payload")
		}

		now := time.Now().UTC()

		_, err := db.Exec(`
			INSERT OR REPLACE INTO heartbeats (service_id, token, last_notification)
			VALUES (?, ?, ?)
		`, req.ServiceID, req.Token, now)

		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}

		return c.SendStatus(200)
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		var req ServicesRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(500).SendString("Internal server error")
		}

		if req.Token == "" {
			return c.Status(500).SendString("Internal server error")
		}

		rows, err := db.Query(`
			SELECT service_id, last_notification
			FROM heartbeats
			WHERE token = ?
			ORDER BY service_id
		`, req.Token)

		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}
		defer rows.Close()

		var services []ServiceResponse
		for rows.Next() {
			var service ServiceResponse
			var lastNotification time.Time
			err := rows.Scan(&service.ServiceID, &lastNotification)
			if err != nil {
				return c.Status(500).SendString("Internal server error")
			}
			service.LastNotification = lastNotification.Format(time.RFC3339)
			services = append(services, service)
		}

		if services == nil {
			services = []ServiceResponse{}
		}

		return c.JSON(services)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}