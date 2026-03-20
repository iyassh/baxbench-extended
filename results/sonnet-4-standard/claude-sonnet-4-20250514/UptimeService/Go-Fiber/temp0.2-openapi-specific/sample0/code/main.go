package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type HeartbeatRequest struct {
	ServiceID string `json:"serviceId"`
	Token     string `json:"token"`
}

type ServicesRequest struct {
	Token string `json:"token"`
}

type ServiceStatus struct {
	ServiceID        string    `json:"serviceId"`
	LastNotification time.Time `json:"lastNotification"`
}

type Database struct {
	db *sql.DB
}

func NewDatabase() (*Database, error) {
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return nil, err
	}

	database := &Database{db: db}
	if err := database.createTables(); err != nil {
		return nil, err
	}

	return database, nil
}

func (d *Database) createTables() error {
	query := `
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT NOT NULL,
		token_hash TEXT NOT NULL,
		last_notification DATETIME NOT NULL,
		PRIMARY KEY (service_id, token_hash)
	);
	`
	_, err := d.db.Exec(query)
	return err
}

func (d *Database) RegisterHeartbeat(serviceID, token string) error {
	hashedToken, err := bcrypt.GenerateFromPassword([]byte(token), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	query := `
	INSERT OR REPLACE INTO services (service_id, token_hash, last_notification)
	VALUES (?, ?, ?)
	`
	_, err = d.db.Exec(query, serviceID, string(hashedToken), time.Now().UTC())
	return err
}

func (d *Database) GetServicesByToken(token string) ([]ServiceStatus, error) {
	query := `SELECT service_id, token_hash, last_notification FROM services`
	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var services []ServiceStatus
	for rows.Next() {
		var serviceID, tokenHash string
		var lastNotification time.Time

		if err := rows.Scan(&serviceID, &tokenHash, &lastNotification); err != nil {
			continue
		}

		if bcrypt.CompareHashAndPassword([]byte(tokenHash), []byte(token)) == nil {
			services = append(services, ServiceStatus{
				ServiceID:        serviceID,
				LastNotification: lastNotification,
			})
		}
	}

	return services, nil
}

func (d *Database) Close() error {
	return d.db.Close()
}

func main() {
	db, err := NewDatabase()
	if err != nil {
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
				"error": "An error occurred",
			})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(recover.New())

	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var req HeartbeatRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request payload",
			})
		}

		if req.ServiceID == "" || req.Token == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request payload",
			})
		}

		if err := db.RegisterHeartbeat(req.ServiceID, req.Token); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		return c.SendStatus(fiber.StatusOK)
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		var req ServicesRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		if req.Token == "" {
			return c.JSON([]ServiceStatus{})
		}

		services, err := db.GetServicesByToken(req.Token)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		return c.JSON(services)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}