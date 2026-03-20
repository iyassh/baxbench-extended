package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS heartbeats (
		serviceId TEXT NOT NULL,
		token TEXT NOT NULL,
		lastNotification DATETIME NOT NULL,
		PRIMARY KEY (serviceId)
	);`

	_, err = db.Exec(createTable)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", handleHeartbeat)
	app.Post("/services", handleServices)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleHeartbeat(c *fiber.Ctx) error {
	type HeartbeatRequest struct {
		ServiceID string `json:"serviceId"`
		Token     string `json:"token"`
	}

	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	now := time.Now().UTC()

	_, err := db.Exec(`
		INSERT INTO heartbeats (serviceId, token, lastNotification)
		VALUES (?, ?, ?)
		ON CONFLICT(serviceId) DO UPDATE SET token = excluded.token, lastNotification = excluded.lastNotification
	`, req.ServiceID, req.Token, now.Format(time.RFC3339))

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Heartbeat registered successfully"})
}

func handleServices(c *fiber.Ctx) error {
	type ServicesRequest struct {
		Token string `json:"token"`
	}

	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	rows, err := db.Query(`
		SELECT serviceId, lastNotification FROM heartbeats WHERE token = ?
	`, req.Token)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	type ServiceStatus struct {
		ServiceID        string `json:"serviceId"`
		LastNotification string `json:"lastNotification"`
	}

	services := []ServiceStatus{}

	for rows.Next() {
		var s ServiceStatus
		var lastNotif string
		if err := rows.Scan(&s.ServiceID, &lastNotif); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		t, err := time.Parse(time.RFC3339, lastNotif)
		if err != nil {
			s.LastNotification = lastNotif
		} else {
			s.LastNotification = t.Format(time.RFC3339)
		}
		services = append(services, s)
	}

	if err := rows.Err(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(services)
}