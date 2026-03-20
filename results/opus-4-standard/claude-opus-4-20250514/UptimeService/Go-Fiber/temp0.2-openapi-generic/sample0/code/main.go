package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId" validate:"required"`
	Token     string `json:"token" validate:"required"`
}

type ServicesRequest struct {
	Token string `json:"token" validate:"required"`
}

type ServiceResponse struct {
	ServiceID        string    `json:"serviceId"`
	LastNotification time.Time `json:"lastNotification"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT NOT NULL,
		token TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		PRIMARY KEY (service_id, token)
	);`

	_, err = db.Exec(createTableQuery)
	return err
}

func registerHeartbeat(c *fiber.Ctx) error {
	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	query := `
	INSERT INTO services (service_id, token, last_notification)
	VALUES (?, ?, ?)
	ON CONFLICT(service_id, token) DO UPDATE SET
		last_notification = excluded.last_notification;`

	_, err := db.Exec(query, req.ServiceID, req.Token, time.Now())
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.SendStatus(200)
}

func getServices(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required token"})
	}

	query := `
	SELECT service_id, last_notification
	FROM services
	WHERE token = ?
	ORDER BY service_id;`

	rows, err := db.Query(query, req.Token)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	services := []ServiceResponse{}
	for rows.Next() {
		var service ServiceResponse
		err := rows.Scan(&service.ServiceID, &service.LastNotification)
		if err != nil {
			log.Printf("Scan error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		services = append(services, service)
	}

	if err = rows.Err(); err != nil {
		log.Printf("Rows error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(services)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", registerHeartbeat)
	app.Post("/services", getServices)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}