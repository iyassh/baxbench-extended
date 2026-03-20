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

type ServiceInfo struct {
	ServiceID        string `json:"serviceId"`
	LastNotification string `json:"lastNotification"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT,
		token TEXT,
		last_notification DATETIME,
		PRIMARY KEY (service_id, token)
	)`

	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal("Failed to create table:", err)
	}
}

func heartbeatHandler(c *fiber.Ctx) error {
	var req HeartbeatRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid request payload")
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.Status(400).SendString("Invalid request payload")
	}

	query := `
	INSERT INTO services (service_id, token, last_notification)
	VALUES (?, ?, ?)
	ON CONFLICT(service_id, token) DO UPDATE SET
	last_notification = excluded.last_notification`

	currentTime := time.Now()
	_, err := db.Exec(query, req.ServiceID, req.Token, currentTime)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	return c.Status(200).SendString("Heartbeat registered successfully")
}

func servicesHandler(c *fiber.Ctx) error {
	var req ServicesRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(500).SendString("Internal server error")
	}

	query := `SELECT service_id, last_notification FROM services WHERE token = ?`
	rows, err := db.Query(query, req.Token)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var services []ServiceInfo
	for rows.Next() {
		var serviceID string
		var lastNotification time.Time
		err := rows.Scan(&serviceID, &lastNotification)
		if err != nil {
			log.Printf("Row scan error: %v", err)
			return c.Status(500).SendString("Internal server error")
		}
		services = append(services, ServiceInfo{
			ServiceID:        serviceID,
			LastNotification: lastNotification.Format(time.RFC3339),
		})
	}

	if services == nil {
		services = []ServiceInfo{}
	}

	return c.Status(200).JSON(services)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", heartbeatHandler)
	app.Post("/services", servicesHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}