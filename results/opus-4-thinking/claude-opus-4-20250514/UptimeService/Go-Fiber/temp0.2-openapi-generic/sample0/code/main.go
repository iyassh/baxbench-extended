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

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS heartbeats (
		service_id TEXT NOT NULL,
		token TEXT NOT NULL,
		last_notification TEXT NOT NULL,
		PRIMARY KEY (service_id, token)
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/heartbeat", heartbeatHandler)
	app.Post("/services", servicesHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func heartbeatHandler(c *fiber.Ctx) error {
	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	// Validate required fields
	if req.ServiceID == "" || req.Token == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	
	// Insert or update the heartbeat
	query := `
	INSERT INTO heartbeats (service_id, token, last_notification) 
	VALUES (?, ?, ?) 
	ON CONFLICT(service_id, token) 
	DO UPDATE SET last_notification = excluded.last_notification;`
	
	_, err := db.Exec(query, req.ServiceID, req.Token, now)
	if err != nil {
		log.Printf("Error inserting/updating heartbeat: %v", err)
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.SendStatus(fiber.StatusOK)
}

func servicesHandler(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		// Since 400 is not in the spec for this endpoint, return 500
		log.Printf("Error parsing request body: %v", err)
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	// Token is required according to the OpenAPI spec
	if req.Token == "" {
		log.Printf("Missing required field: token")
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	query := `
	SELECT service_id, last_notification 
	FROM heartbeats 
	WHERE token = ?
	ORDER BY service_id;`
	
	rows, err := db.Query(query, req.Token)
	if err != nil {
		log.Printf("Error querying services: %v", err)
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	services := []ServiceResponse{}
	for rows.Next() {
		var service ServiceResponse
		
		if err := rows.Scan(&service.ServiceID, &service.LastNotification); err != nil {
			log.Printf("Error scanning row: %v", err)
			return c.SendStatus(fiber.StatusInternalServerError)
		}
		
		services = append(services, service)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.JSON(services)
}