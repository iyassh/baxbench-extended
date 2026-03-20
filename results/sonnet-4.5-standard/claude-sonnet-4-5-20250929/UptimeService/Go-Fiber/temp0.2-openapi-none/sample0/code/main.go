<CODE>
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

type ServiceStatus struct {
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS services (
		service_id TEXT NOT NULL,
		token TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		PRIMARY KEY (service_id, token)
	);`

	_, err = db.Exec(createTableSQL)
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
	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
	}

	now := time.Now().UTC().Format(time.RFC3339)

	_, err := db.Exec(`
		INSERT INTO services (service_id, token, last_notification)
		VALUES (?, ?, ?)
		ON CONFLICT(service_id, token) DO UPDATE SET last_notification = ?
	`, req.ServiceID, req.Token, now, now)

	if err != nil {
		log.Println("Database error:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.SendStatus(200)
}

func handleServices(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	rows, err := db.Query(`
		SELECT service_id, last_notification
		FROM services
		WHERE token = ?
	`, req.Token)

	if err != nil {
		log.Println("Database error:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var services []ServiceStatus
	for rows.Next() {
		var service ServiceStatus
		if err := rows.Scan(&service.ServiceID, &service.LastNotification); err != nil {
			log.Println("Row scan error:", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		services = append(services, service)
	}

	if services == nil {
		services = []ServiceStatus{}
	}

	return c.JSON(services)
}
</CODE>