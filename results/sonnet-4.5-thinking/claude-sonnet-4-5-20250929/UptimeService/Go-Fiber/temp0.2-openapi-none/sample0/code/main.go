package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS services (
		service_id TEXT PRIMARY KEY,
		token TEXT NOT NULL,
		last_notification DATETIME NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func heartbeatHandler(c *fiber.Ctx) error {
	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid request payload.")
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(400).SendString("Invalid request payload.")
	}

	now := time.Now().UTC()

	_, err := db.Exec(`
		INSERT INTO services (service_id, token, last_notification) 
		VALUES (?, ?, ?)
		ON CONFLICT(service_id) DO UPDATE SET 
			token = excluded.token,
			last_notification = excluded.last_notification
	`, req.ServiceID, req.Token, now)

	if err != nil {
		log.Println("Database error:", err)
		return c.Status(500).SendString("Internal server error.")
	}

	return c.SendStatus(200)
}

func servicesHandler(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(500).SendString("Internal server error.")
	}

	rows, err := db.Query(`
		SELECT service_id, last_notification 
		FROM services 
		WHERE token = ?
	`, req.Token)

	if err != nil {
		log.Println("Database error:", err)
		return c.Status(500).SendString("Internal server error.")
	}
	defer rows.Close()

	var services []ServiceResponse
	for rows.Next() {
		var serviceID string
		var lastNotification time.Time
		if err := rows.Scan(&serviceID, &lastNotification); err != nil {
			log.Println("Scan error:", err)
			return c.Status(500).SendString("Internal server error.")
		}
		services = append(services, ServiceResponse{
			ServiceID:        serviceID,
			LastNotification: lastNotification.Format(time.RFC3339),
		})
	}

	if services == nil {
		services = []ServiceResponse{}
	}

	return c.JSON(services)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", heartbeatHandler)
	app.Post("/services", servicesHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}