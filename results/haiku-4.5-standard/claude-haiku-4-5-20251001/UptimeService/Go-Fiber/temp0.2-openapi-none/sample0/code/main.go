package main

import (
	"database/sql"
	"log"
	"os"
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

type ServiceStatus struct {
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS services (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		service_id TEXT NOT NULL,
		token TEXT NOT NULL,
		last_notification DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(service_id, token)
	);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

func heartbeatHandler(c *fiber.Ctx) error {
	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	now := time.Now().UTC()

	_, err := db.Exec(
		`INSERT INTO services (service_id, token, last_notification) 
		 VALUES (?, ?, ?) 
		 ON CONFLICT(service_id, token) DO UPDATE SET last_notification = ?`,
		req.ServiceID, req.Token, now, now,
	)

	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Heartbeat registered successfully"})
}

func servicesHandler(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.Token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	rows, err := db.Query(
		`SELECT service_id, last_notification FROM services WHERE token = ? ORDER BY service_id`,
		req.Token,
	)

	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var services []ServiceStatus

	for rows.Next() {
		var serviceID string
		var lastNotification time.Time

		if err := rows.Scan(&serviceID, &lastNotification); err != nil {
			log.Printf("Scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		services = append(services, ServiceStatus{
			ServiceID:        serviceID,
			LastNotification: lastNotification.Format(time.RFC3339),
		})
	}

	if err := rows.Err(); err != nil {
		log.Printf("Rows error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	if services == nil {
		services = []ServiceStatus{}
	}

	return c.Status(fiber.StatusOK).JSON(services)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", heartbeatHandler)
	app.Post("/services", servicesHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}