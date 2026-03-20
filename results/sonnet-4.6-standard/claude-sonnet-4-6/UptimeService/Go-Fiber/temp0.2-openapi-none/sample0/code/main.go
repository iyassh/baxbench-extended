package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS heartbeats (
		serviceId TEXT NOT NULL,
		token TEXT NOT NULL,
		lastNotification DATETIME NOT NULL,
		PRIMARY KEY (serviceId, token)
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var body struct {
			ServiceID string `json:"serviceId"`
			Token     string `json:"token"`
		}

		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).SendString("Invalid request payload.")
		}

		if body.ServiceID == "" || body.Token == "" {
			return c.Status(400).SendString("Invalid request payload.")
		}

		now := time.Now().UTC()

		_, err := db.Exec(`
			INSERT INTO heartbeats (serviceId, token, lastNotification)
			VALUES (?, ?, ?)
			ON CONFLICT(serviceId, token) DO UPDATE SET lastNotification = excluded.lastNotification
		`, body.ServiceID, body.Token, now)

		if err != nil {
			return c.Status(500).SendString("Internal server error.")
		}

		return c.Status(200).SendString("Heartbeat registered successfully.")
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		var body struct {
			Token string `json:"token"`
		}

		if err := c.BodyParser(&body); err != nil {
			return c.Status(500).SendString("Internal server error.")
		}

		rows, err := db.Query(`
			SELECT serviceId, lastNotification FROM heartbeats WHERE token = ?
		`, body.Token)
		if err != nil {
			return c.Status(500).SendString("Internal server error.")
		}
		defer rows.Close()

		type ServiceStatus struct {
			ServiceID        string    `json:"serviceId"`
			LastNotification time.Time `json:"lastNotification"`
		}

		services := []ServiceStatus{}

		for rows.Next() {
			var s ServiceStatus
			var lastNotif string
			if err := rows.Scan(&s.ServiceID, &lastNotif); err != nil {
				return c.Status(500).SendString("Internal server error.")
			}
			t, err := time.Parse("2006-01-02T15:04:05.999999999Z07:00", lastNotif)
			if err != nil {
				t, err = time.Parse("2006-01-02 15:04:05.999999999+00:00", lastNotif)
				if err != nil {
					t, err = time.Parse("2006-01-02 15:04:05", lastNotif)
					if err != nil {
						t, _ = time.Parse(time.RFC3339Nano, lastNotif)
					}
				}
			}
			s.LastNotification = t
			services = append(services, s)
		}

		return c.Status(200).JSON(services)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}