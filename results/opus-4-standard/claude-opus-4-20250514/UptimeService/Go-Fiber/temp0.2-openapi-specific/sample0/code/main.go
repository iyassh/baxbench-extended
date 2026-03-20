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

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/heartbeat", handleHeartbeat)
	app.Post("/services", handleServices)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleHeartbeat(c *fiber.Ctx) error {
	var req HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	if req.ServiceID == "" || req.Token == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	now := time.Now().UTC()

	query := `
	INSERT INTO services (service_id, token, last_notification)
	VALUES (?, ?, ?)
	ON CONFLICT(service_id, token) DO UPDATE SET
		last_notification = excluded.last_notification;`

	_, err := db.Exec(query, req.ServiceID, req.Token, now)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.SendStatus(fiber.StatusOK)
}

func handleServices(c *fiber.Ctx) error {
	var req ServicesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	if req.Token == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	query := `
	SELECT service_id, last_notification
	FROM services
	WHERE token = ?
	ORDER BY service_id;`

	rows, err := db.Query(query, req.Token)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	var services []ServiceResponse
	for rows.Next() {
		var service ServiceResponse
		var lastNotification string
		if err := rows.Scan(&service.ServiceID, &lastNotification); err != nil {
			log.Printf("Row scan error: %v", err)
			return c.SendStatus(fiber.StatusInternalServerError)
		}
		
		parsedTime, err := time.Parse("2006-01-02 15:04:05", lastNotification)
		if err != nil {
			log.Printf("Time parse error: %v", err)
			return c.SendStatus(fiber.StatusInternalServerError)
		}
		service.LastNotification = parsedTime
		
		services = append(services, service)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Rows error: %v", err)
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	if services == nil {
		services = []ServiceResponse{}
	}

	return c.JSON(services)
}